// BR Sisloja — função "nota-fiscal" (Supabase Edge Function)
// Emite, consulta e cancela NFC-e e NF-e de uma venda pela Focus NFe.
// O token da Focus fica só aqui (segredos FOCUS_TOKEN e FOCUS_AMBIENTE), nunca no navegador.
//
// Corpo da chamada (POST, JSON):
//   { acao: 'emitir',    venda_id, modelo: 'nfce' | 'nfe', destinatario?: {...} }
//   { acao: 'consultar', nota_id }
//   { acao: 'cancelar',  nota_id, justificativa }   (mínimo 15 letras, regra da SEFAZ)
// Resposta: sempre 200 com { ok: true, nota } ou { ok: false, erro }.
import { createClient } from 'npm:@supabase/supabase-js@2';

const AMBIENTE = (Deno.env.get('FOCUS_AMBIENTE') || 'homologacao').toLowerCase();
const PRODUCAO = AMBIENTE === 'producao';
const BASE = PRODUCAO ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br';
const TOKEN = Deno.env.get('FOCUS_TOKEN') || '';
const HOMOLOG = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (corpo: unknown) => new Response(JSON.stringify(corpo), { headers: { ...cors, 'Content-Type': 'application/json' } });
const so = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// forma de pagamento da venda -> código da SEFAZ
const PAGAMENTO: Record<string, string> = { dinheiro: '01', cartao_credito: '03', cartao_debito: '04', pix: '17' };

async function focus(metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { Authorization: 'Basic ' + btoa(TOKEN + ':'), 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json: any = {};
  try {
    json = texto ? JSON.parse(texto) : {};
  } catch {
    json = { mensagem: texto };
  }
  return { http: r.status, json };
}

// traduz o retorno da Focus para os campos da tabela notas_fiscais
function campos(json: any) {
  const st = String(json.status || '');
  const status =
    st === 'autorizado' ? 'autorizada' : st === 'cancelado' ? 'cancelada' : st.startsWith('processando') ? 'processando' : 'erro';
  const erros = Array.isArray(json.erros) ? json.erros.map((e: any) => e.mensagem).join(' | ') : '';
  return {
    status,
    numero: json.numero ? String(json.numero) : undefined,
    serie: json.serie ? String(json.serie) : undefined,
    chave: json.chave_nfe ? String(json.chave_nfe).replace(/^NFe/, '') : undefined,
    protocolo: json.protocolo ? String(json.protocolo) : undefined,
    url_danfe: json.caminho_danfe ? BASE + json.caminho_danfe : undefined,
    url_xml: json.caminho_xml_nota_fiscal ? BASE + json.caminho_xml_nota_fiscal : undefined,
    mensagem: [json.mensagem_sefaz || json.mensagem, erros].filter(Boolean).join(' — ') || null,
    retorno: json,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!TOKEN) return responder({ ok: false, erro: 'Falta configurar o segredo FOCUS_TOKEN da função nota-fiscal no Supabase.' });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    // quem está chamando (login do sistema) e de qual loja
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await admin.auth.getUser(jwt);
    if (!u?.user) return responder({ ok: false, erro: 'Entre no sistema de novo (sessão expirada).' });
    const { data: perfil } = await admin.from('perfis').select('codigo_loja, perfil, ativo, nome').eq('user_id', u.user.id).maybeSingle();
    if (!perfil?.ativo || !perfil.codigo_loja) return responder({ ok: false, erro: 'Usuário sem acesso à loja.' });
    const papel = String(perfil.perfil || '').toLowerCase();
    if (!['admin', 'gerente', 'colaborador', 'vendedor', 'caixa'].includes(papel)) return responder({ ok: false, erro: 'Sem permissão para nota fiscal.' });
    const loja = perfil.codigo_loja as string;

    const corpo = await req.json();

    // ---------------- EMITIR ----------------
    if (corpo.acao === 'emitir') {
      const modelo = corpo.modelo === 'nfe' ? 'nfe' : 'nfce';
      const { data: venda } = await admin.from('vendas').select('*').eq('id', corpo.venda_id).eq('codigo_loja', loja).maybeSingle();
      if (!venda) return responder({ ok: false, erro: 'Venda não encontrada.' });
      if (venda.cancelada_em || String(venda.status || '').toLowerCase().startsWith('cancel'))
        return responder({ ok: false, erro: 'Venda cancelada não pode ter nota.' });

      const { data: existentes } = await admin.from('notas_fiscais').select('id, modelo, status').eq('venda_id', venda.id).in('status', ['autorizada', 'processando']);
      if (existentes?.length) return responder({ ok: false, erro: `Esta venda já tem ${existentes[0].modelo.toUpperCase()} ${existentes[0].status}.` });

      const { data: dadosLoja } = await admin.from('lojas').select('*').eq('codigo_loja', loja).maybeSingle();
      const cnpj = so(dadosLoja?.cnpj);
      if (cnpj.length !== 14) return responder({ ok: false, erro: 'Cadastre o CNPJ da loja (arquivo fase8_nota_fiscal.sql, passo 4).' });
      const ufLoja = String(dadosLoja?.uf || '').toUpperCase();

      const { data: itens } = await admin
        .from('venda_itens')
        .select('produto_id, nome, quantidade, preco_unitario, subtotal')
        .eq('venda_id', venda.id)
        .order('id');
      if (!itens?.length) return responder({ ok: false, erro: 'Venda sem itens.' });
      const { data: prods } = await admin
        .from('produtos')
        .select('id, sku, codigo_barras, unidade, ncm, cest, cfop_padrao, origem, csosn_cst')
        .in('id', itens.map((i: any) => i.produto_id));
      const prod: Record<string, any> = {};
      (prods || []).forEach((p: any) => (prod[p.id] = p));

      // NCM é obrigatório: avisa todos os que faltam de uma vez
      const semNcm = itens.filter((i: any) => so(prod[i.produto_id]?.ncm).length !== 8).map((i: any) => i.nome);
      if (semNcm.length) return responder({ ok: false, erro: 'Produto(s) sem NCM válido (8 números) no cadastro: ' + semNcm.join('; ') });

      // destinatário
      const d = corpo.destinatario || {};
      const doc = so(d.cpf_cnpj);
      if (modelo === 'nfe') {
        if (doc.length !== 11 && doc.length !== 14) return responder({ ok: false, erro: 'NF-e: informe o CPF ou CNPJ do cliente.' });
        for (const [campo, rot] of [['nome', 'nome'], ['logradouro', 'endereço'], ['numero', 'número'], ['bairro', 'bairro'], ['municipio', 'cidade'], ['uf', 'UF'], ['cep', 'CEP']])
          if (!String(d[campo] || '').trim()) return responder({ ok: false, erro: `NF-e: informe o ${rot} do cliente.` });
      } else if (doc && doc.length !== 11 && doc.length !== 14) {
        return responder({ ok: false, erro: 'CPF/CNPJ do consumidor inválido.' });
      }
      const ufDest = String(d.uf || '').toUpperCase();
      const interestadual = modelo === 'nfe' && ufLoja && ufDest && ufLoja !== ufDest;

      // desconto da venda dividido entre os itens (proporcional; a sobra de centavos vai no último)
      const desconto = r2(Number(venda.desconto || 0));
      const bruto = itens.reduce((s: number, i: any) => s + Number(i.subtotal), 0);
      let restante = desconto;

      const items = itens.map((i: any, k: number) => {
        const p = prod[i.produto_id] || {};
        const ultimo = k === itens.length - 1;
        const desc = ultimo ? r2(restante) : r2(bruto > 0 ? (desconto * Number(i.subtotal)) / bruto : 0);
        restante = r2(restante - desc);
        const csosn = String(p.csosn_cst || dadosLoja?.nf_csosn_padrao || '102');
        let cfop = so(p.cfop_padrao) || '5102';
        if (csosn === '500' && cfop === '5102') cfop = '5405'; // mercadoria com ST já recolhida
        if (interestadual && cfop.startsWith('5')) cfop = '6' + cfop.slice(1);
        const gtin = so(p.codigo_barras);
        const gtinOk = [8, 12, 13, 14].includes(gtin.length) ? gtin : 'SEM GTIN';
        const un = String(p.unidade || 'UN').toUpperCase().slice(0, 6);
        const item: Record<string, unknown> = {
          numero_item: String(k + 1),
          codigo_produto: p.sku || String(k + 1),
          descricao: !PRODUCAO && k === 0 ? HOMOLOG : String(i.nome).slice(0, 120),
          cfop,
          codigo_ncm: so(p.ncm),
          unidade_comercial: un,
          quantidade_comercial: Number(i.quantidade),
          valor_unitario_comercial: Number(i.preco_unitario),
          unidade_tributavel: un,
          quantidade_tributavel: Number(i.quantidade),
          valor_unitario_tributavel: Number(i.preco_unitario),
          valor_bruto: r2(Number(i.subtotal)),
          codigo_barras_comercial: gtinOk,
          codigo_barras_tributavel: gtinOk,
          inclui_no_total: 1,
          icms_origem: String(p.origem || '0').slice(0, 1),
          icms_situacao_tributaria: csosn,
          pis_situacao_tributaria: String(dadosLoja?.nf_pis_cst || '49'),
          cofins_situacao_tributaria: String(dadosLoja?.nf_cofins_cst || '49'),
        };
        if (desc > 0) item.valor_desconto = desc;
        if (so(p.cest)) item.cest = so(p.cest);
        return item;
      });

      // pagamento (dinheiro: valor recebido e troco)
      const total = r2(Number(venda.total));
      const recebido = venda.forma_pagamento === 'dinheiro' && venda.valor_recebido ? r2(Number(venda.valor_recebido)) : total;
      const pag: Record<string, unknown> = { forma_pagamento: PAGAMENTO[venda.forma_pagamento] || '99', valor_pagamento: recebido };
      if (venda.forma_pagamento === 'cartao_credito' || venda.forma_pagamento === 'cartao_debito') pag.tipo_integracao = '2';

      const nota: Record<string, unknown> = {
        cnpj_emitente: cnpj,
        data_emissao: new Date().toISOString(),
        natureza_operacao: modelo === 'nfce' ? 'VENDA AO CONSUMIDOR' : 'VENDA DE MERCADORIA',
        presenca_comprador: '1',
        modalidade_frete: '9',
        local_destino: interestadual ? '2' : '1',
        items,
        formas_pagamento: [pag],
      };
      if (recebido > total) nota.valor_troco = r2(recebido - total);

      const nomeDest = !PRODUCAO ? HOMOLOG : String(d.nome || '').trim();
      if (modelo === 'nfe') {
        const indIE = so(d.ie) ? '1' : '9'; // 1 = contribuinte com IE, 9 = não contribuinte
        Object.assign(nota, {
          tipo_documento: '1',
          finalidade_emissao: '1',
          consumidor_final: indIE === '1' ? '0' : '1',
          nome_destinatario: nomeDest,
          [doc.length === 14 ? 'cnpj_destinatario' : 'cpf_destinatario']: doc,
          indicador_inscricao_estadual_destinatario: d.indicador_ie || indIE,
          logradouro_destinatario: d.logradouro,
          numero_destinatario: d.numero,
          bairro_destinatario: d.bairro,
          municipio_destinatario: d.municipio,
          uf_destinatario: ufDest,
          cep_destinatario: so(d.cep),
          pais_destinatario: 'Brasil',
        });
        if (so(d.ie)) nota.inscricao_estadual_destinatario = so(d.ie);
        if (d.email) nota.email_destinatario = d.email;
        if (so(d.telefone)) nota.telefone_destinatario = so(d.telefone);
      } else {
        nota.indicador_inscricao_estadual_destinatario = '9';
        nota.consumidor_final = '1';
        if (doc) {
          nota[doc.length === 14 ? 'cnpj_destinatario' : 'cpf_destinatario'] = doc;
          if (d.nome || !PRODUCAO) nota.nome_destinatario = nomeDest;
        }
      }

      // registra a tentativa antes de enviar (o id vira a "ref" da Focus)
      const { data: linha, error: e1 } = await admin
        .from('notas_fiscais')
        .insert({ codigo_loja: loja, venda_id: venda.id, modelo, status: 'processando', destinatario: doc ? d : null, created_by: u.user.id, usuario: perfil.nome })
        .select()
        .single();
      if (e1) return responder({ ok: false, erro: 'Não consegui registrar a nota: ' + e1.message });

      const r = await focus('POST', `/v2/${modelo}?ref=${linha.id}`, nota);
      const c = campos(r.json);
      if (r.http >= 400 && !r.json.status) c.status = 'erro';
      const { data: final } = await admin.from('notas_fiscais').update(c).eq('id', linha.id).select().single();
      if (c.status === 'autorizada') await admin.rpc('nf_mov_estoque', { p_nota: linha.id, p_sinal: -1 });
      return responder({ ok: c.status !== 'erro', nota: final, erro: c.status === 'erro' ? c.mensagem || 'Nota recusada.' : undefined });
    }

    // nota existente desta loja
    const { data: nf } = await admin.from('notas_fiscais').select('*').eq('id', corpo.nota_id).eq('codigo_loja', loja).maybeSingle();
    if (!nf) return responder({ ok: false, erro: 'Nota não encontrada.' });

    // ---------------- CONSULTAR (NF-e fica "processando" alguns segundos) ----------------
    if (corpo.acao === 'consultar') {
      const r = await focus('GET', `/v2/${nf.modelo}/${nf.id}`);
      if (r.http === 404) return responder({ ok: false, erro: 'A Focus não encontrou esta nota.', nota: nf });
      const c = campos(r.json);
      const { data: final } = await admin.from('notas_fiscais').update(c).eq('id', nf.id).select().single();
      if (c.status === 'autorizada') await admin.rpc('nf_mov_estoque', { p_nota: nf.id, p_sinal: -1 });
      return responder({ ok: true, nota: final });
    }

    // ---------------- CANCELAR ----------------
    if (corpo.acao === 'cancelar') {
      const just = String(corpo.justificativa || '').trim();
      if (just.length < 15) return responder({ ok: false, erro: 'A justificativa precisa ter pelo menos 15 letras (regra da SEFAZ).' });
      if (nf.status !== 'autorizada') return responder({ ok: false, erro: 'Só nota autorizada pode ser cancelada.' });
      const r = await focus('DELETE', `/v2/${nf.modelo}/${nf.id}`, { justificativa: just.slice(0, 255) });
      const st = String(r.json.status || '');
      if (st !== 'cancelado') {
        const msg = r.json.mensagem_sefaz || r.json.mensagem || 'A SEFAZ não aceitou o cancelamento.';
        return responder({ ok: false, erro: msg, nota: nf });
      }
      const { data: final } = await admin
        .from('notas_fiscais')
        .update({
          status: 'cancelada',
          cancelada_em: new Date().toISOString(),
          motivo_cancelamento: just,
          mensagem: r.json.mensagem_sefaz || 'Cancelada',
          url_xml: r.json.caminho_xml_cancelamento ? BASE + r.json.caminho_xml_cancelamento : nf.url_xml,
        })
        .eq('id', nf.id)
        .select()
        .single();
      await admin.rpc('nf_mov_estoque', { p_nota: nf.id, p_sinal: 1 });
      return responder({ ok: true, nota: final });
    }

    return responder({ ok: false, erro: 'Ação inválida.' });
  } catch (e) {
    return responder({ ok: false, erro: 'Erro na função nota-fiscal: ' + (e instanceof Error ? e.message : String(e)) });
  }
});
