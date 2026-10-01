// BR Sisloja - Fase 2
// Leitura do XML da NF-e (modelo 55) no navegador e rateio das despesas da nota no custo de cada item.
 
export type NfeEndereco = {
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    codigo_municipio: string;
    uf: string;
    cep: string;
    telefone: string;
  };
   
  export type NfeEmitente = {
    cnpj_cpf: string;
    razao_social: string;
    nome_fantasia: string;
    ie: string;
    crt: string; // 1 = Simples Nacional, 2 = Simples excesso, 3 = Regime normal, 4 = MEI
    endereco: NfeEndereco;
  };
   
  export type NfeItem = {
    item: number;
    codigo_fornecedor: string;
    ean: string; // EAN da embalagem comprada (cEAN)
    ean_trib: string; // EAN da unidade tributável (cEANTrib), geralmente a unidade vendida
    descricao: string;
    ncm: string;
    cest: string;
    cfop: string;
    origem: string; // origem da mercadoria (0 = nacional, 1/2 = importada...)
    unidade: string;
    quantidade: number;
    unidade_trib: string;
    quantidade_trib: number;
    fator_sugerido: number; // quantas unidades de venda vêm em cada unidade comprada (ex.: CX com 12)
    valor_unitario: number;
    valor_produtos: number;
    frete: number;
    seguro: number;
    desconto: number;
    outras: number;
    ipi: number;
    st: number; // ICMS ST + FCP ST
    icms: number;
    // calculados
    custo_total: number; // valor_produtos + frete + seguro + outras + ipi + st - desconto
    custo_unitario: number; // custo_total / quantidade (na unidade do fornecedor)
  };
   
  export type NfeDuplicata = { numero: string; vencimento: string; valor: number };
   
  export type Nfe = {
    chave: string;
    numero: string;
    serie: string;
    modelo: string;
    data_emissao: string; // AAAA-MM-DD
    natureza: string;
    emitente: NfeEmitente;
    destinatario_cnpj: string;
    itens: NfeItem[];
    duplicatas: NfeDuplicata[];
    totais: {
      produtos: number;
      frete: number;
      seguro: number;
      desconto: number;
      outras: number;
      ipi: number;
      st: number;
      icms: number;
      nota: number;
    };
  };
   
  const num = (v: string | null | undefined) => {
    const n = parseFloat((v || '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  };
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
   
  // pega o primeiro elemento com esse nome (ignora namespace)
  function el(pai: Element | Document | null | undefined, nome: string): Element | null {
    if (!pai) return null;
    const lista = pai.getElementsByTagNameNS('*', nome);
    if (lista.length) return lista[0];
    const lista2 = pai.getElementsByTagName(nome);
    return lista2.length ? lista2[0] : null;
  }
  function els(pai: Element | Document | null | undefined, nome: string): Element[] {
    if (!pai) return [];
    let lista = pai.getElementsByTagNameNS('*', nome);
    if (!lista.length) lista = pai.getElementsByTagName(nome);
    return Array.from(lista);
  }
  function txt(pai: Element | Document | null | undefined, nome: string): string {
    return (el(pai, nome)?.textContent || '').trim();
  }
  // filho direto (evita pegar, por ex., o vFrete do item quando queremos o do total)
  function filho(pai: Element | null, nome: string): Element | null {
    if (!pai) return null;
    for (const c of Array.from(pai.children)) if (c.localName === nome) return c;
    return null;
  }
  function ftxt(pai: Element | null, nome: string): string {
    return (filho(pai, nome)?.textContent || '').trim();
  }
   
  export function somenteDigitos(s: string) {
    return (s || '').replace(/\D/g, '');
  }
   
  // EAN válido? (8, 12, 13 ou 14 dígitos; "SEM GTIN" e zeros são ignorados)
  export function eanValido(s: string) {
    const d = somenteDigitos(s);
    if (![8, 12, 13, 14].includes(d.length)) return '';
    if (/^0+$/.test(d)) return '';
    return d;
  }
   
  export function lerNfe(xmlTexto: string): Nfe {
    const doc = new DOMParser().parseFromString(xmlTexto.replace(/^﻿/, ''), 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('O arquivo não é um XML válido.');
    }
    const infNFe = el(doc, 'infNFe');
    if (!infNFe) {
      if (el(doc, 'infCte')) throw new Error('Este XML é de um CT-e (conhecimento de transporte), não de uma NF-e.');
      if (el(doc, 'resNFe')) throw new Error('Este XML é só o resumo da nota. Baixe o XML completo (procNFe) com o fornecedor.');
      throw new Error('Não encontrei uma NF-e neste XML.');
    }
   
    let chave = somenteDigitos(infNFe.getAttribute('Id') || '');
    if (chave.length !== 44) chave = somenteDigitos(txt(doc, 'chNFe'));
    if (chave.length !== 44) throw new Error('Não encontrei a chave de acesso (44 dígitos) neste XML.');
   
    const ide = el(infNFe, 'ide');
    const emit = el(infNFe, 'emit');
    const enderEmit = el(emit, 'enderEmit');
    const dest = el(infNFe, 'dest');
   
    const emitente: NfeEmitente = {
      cnpj_cpf: somenteDigitos(ftxt(emit, 'CNPJ') || ftxt(emit, 'CPF')),
      razao_social: ftxt(emit, 'xNome'),
      nome_fantasia: ftxt(emit, 'xFant'),
      ie: ftxt(emit, 'IE'),
      crt: ftxt(emit, 'CRT'),
      endereco: {
        logradouro: ftxt(enderEmit, 'xLgr'),
        numero: ftxt(enderEmit, 'nro'),
        complemento: ftxt(enderEmit, 'xCpl'),
        bairro: ftxt(enderEmit, 'xBairro'),
        cidade: ftxt(enderEmit, 'xMun'),
        codigo_municipio: ftxt(enderEmit, 'cMun'),
        uf: ftxt(enderEmit, 'UF'),
        cep: somenteDigitos(ftxt(enderEmit, 'CEP')),
        telefone: somenteDigitos(ftxt(enderEmit, 'fone')),
      },
    };
   
    const dhEmi = ftxt(ide, 'dhEmi') || ftxt(ide, 'dEmi');
   
    const itens: NfeItem[] = els(infNFe, 'det').map((det, i) => {
      const prod = filho(det, 'prod');
      const imposto = filho(det, 'imposto');
      const ipi = el(imposto, 'IPI');
      const icms = el(imposto, 'ICMS');
      const eanCom = eanValido(ftxt(prod, 'cEAN'));
      const eanTrib = eanValido(ftxt(prod, 'cEANTrib'));
      const st = num(txt(icms, 'vICMSST')) + num(txt(icms, 'vFCPST'));
      const unidade = (ftxt(prod, 'uCom') || 'UN').toUpperCase();
      const unidadeTrib = (ftxt(prod, 'uTrib') || unidade).toUpperCase();
      const qCom = num(ftxt(prod, 'qCom'));
      const qTrib = num(ftxt(prod, 'qTrib')) || qCom;
      const fator = unidadeTrib !== unidade && qCom > 0 && qTrib > qCom ? r4(qTrib / qCom) : 1;
      return {
        item: parseInt(det.getAttribute('nItem') || String(i + 1), 10),
        codigo_fornecedor: ftxt(prod, 'cProd'),
        ean: eanCom || eanTrib,
        ean_trib: eanTrib || eanCom,
        descricao: ftxt(prod, 'xProd'),
        ncm: ftxt(prod, 'NCM'),
        cest: ftxt(prod, 'CEST'),
        cfop: ftxt(prod, 'CFOP'),
        origem: txt(icms, 'orig'),
        unidade,
        quantidade: qCom,
        unidade_trib: unidadeTrib,
        quantidade_trib: qTrib,
        fator_sugerido: fator,
        valor_unitario: num(ftxt(prod, 'vUnCom')),
        valor_produtos: num(ftxt(prod, 'vProd')),
        frete: num(ftxt(prod, 'vFrete')),
        seguro: num(ftxt(prod, 'vSeg')),
        desconto: num(ftxt(prod, 'vDesc')),
        outras: num(ftxt(prod, 'vOutro')),
        ipi: num(txt(ipi, 'vIPI')),
        st,
        icms: num(txt(icms, 'vICMS')),
        custo_total: 0,
        custo_unitario: 0,
      };
    });
    if (!itens.length) throw new Error('A nota não tem itens.');
   
    const icmsTot = el(el(infNFe, 'total'), 'ICMSTot');
    const totais = {
      produtos: num(ftxt(icmsTot, 'vProd')),
      frete: num(ftxt(icmsTot, 'vFrete')),
      seguro: num(ftxt(icmsTot, 'vSeg')),
      desconto: num(ftxt(icmsTot, 'vDesc')),
      outras: num(ftxt(icmsTot, 'vOutro')),
      ipi: num(ftxt(icmsTot, 'vIPI')),
      st: num(ftxt(icmsTot, 'vST')) + num(ftxt(icmsTot, 'vFCPST')),
      icms: num(ftxt(icmsTot, 'vICMS')),
      nota: num(ftxt(icmsTot, 'vNF')),
    };
   
    ratearDespesas(itens, totais);
   
    const cobr = el(infNFe, 'cobr');
    let duplicatas: NfeDuplicata[] = els(cobr, 'dup').map((d) => ({
      numero: ftxt(d, 'nDup'),
      vencimento: ftxt(d, 'dVenc').slice(0, 10),
      valor: num(ftxt(d, 'vDup')),
    }));
    duplicatas = duplicatas.filter((d) => d.valor > 0);
   
    return {
      chave,
      numero: ftxt(ide, 'nNF'),
      serie: ftxt(ide, 'serie'),
      modelo: ftxt(ide, 'mod'),
      data_emissao: dhEmi.slice(0, 10),
      natureza: ftxt(ide, 'natOp'),
      emitente,
      destinatario_cnpj: somenteDigitos(ftxt(dest, 'CNPJ') || ftxt(dest, 'CPF')),
      itens,
      duplicatas,
      totais,
    };
  }
   
  // Rateio: a NF-e normalmente já traz frete/seguro/desconto/outras por item.
  // Se a soma dos itens não bater com o total da nota, a diferença é dividida
  // proporcionalmente ao valor dos produtos de cada item.
  export function ratearDespesas(itens: NfeItem[], totais: Nfe['totais']) {
    const base = itens.reduce((s, it) => s + it.valor_produtos, 0) || 1;
    const campos: (keyof Nfe['totais'] & keyof NfeItem)[] = ['frete', 'seguro', 'desconto', 'outras', 'ipi', 'st'];
    for (const campo of campos) {
      const somaItens = r2(itens.reduce((s, it) => s + (it[campo] as number), 0));
      const diferenca = r2(totais[campo] - somaItens);
      if (Math.abs(diferenca) < 0.01) continue;
      let distribuido = 0;
      itens.forEach((it, i) => {
        const parte = i === itens.length - 1 ? r2(diferenca - distribuido) : r2((diferenca * it.valor_produtos) / base);
        distribuido = r2(distribuido + parte);
        (it as any)[campo] = r2((it[campo] as number) + parte);
      });
    }
    for (const it of itens) {
      it.custo_total = r2(it.valor_produtos + it.frete + it.seguro + it.outras + it.ipi + it.st - it.desconto);
      it.custo_unitario = it.quantidade > 0 ? r4(it.custo_total / it.quantidade) : 0;
    }
  }
   
  // Preço de venda = custo x (1 + margem%), arredondado em centavos
  export function precoComMargem(custo: number, margemPercentual: number) {
    return r2(custo * (1 + (margemPercentual || 0) / 100));
  }
   
  // Margem real de um preço digitado à mão
  export function margemDoPreco(custo: number, preco: number) {
    if (!custo) return 0;
    return r2((preco / custo - 1) * 100);
  }
   
  export const arred2 = r2;
  export const arred4 = r4;