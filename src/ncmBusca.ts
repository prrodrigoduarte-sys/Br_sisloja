// Busca de NCM pela descrição do produto, na tabela oficial (BrasilAPI / Siscomex).
// A tabela inteira (~240 KB) é baixada uma vez e fica em memória; a busca é feita aqui no navegador.

export type NcmSugestao = { codigo: string; descricao: string };

type Linha = { codigo: string; descricao: string };

let tabela: Promise<{ folhas: { codigo: string; texto: string; descricao: string }[] }> | null = null;

const normalizar = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const limparDescricao = (s: string) => s.replace(/<[^>]+>/g, '').replace(/^[-\s]+/, '').trim();

function carregarTabela() {
  if (!tabela) {
    tabela = fetch('https://brasilapi.com.br/api/ncm/v1')
      .then((r) => {
        if (!r.ok) throw new Error('NCM indisponível');
        return r.json() as Promise<Linha[]>;
      })
      .then((linhas) => {
        // descrição por código só com dígitos (posição 4, subposição 6, item 7, NCM 8)
        const porCodigo = new Map<string, string>();
        linhas.forEach((l) => porCodigo.set(l.codigo.replace(/\D/g, ''), limparDescricao(l.descricao)));
        const folhas = linhas
          .filter((l) => l.codigo.replace(/\D/g, '').length === 8)
          .map((l) => {
            const d = l.codigo.replace(/\D/g, '');
            // a NCM sozinha costuma ser só "Outros": junta a descrição dos níveis de cima
            const partes = [d.slice(0, 4), d.slice(0, 6), d.slice(0, 7), d]
              .map((c) => porCodigo.get(c))
              .filter((x, i, arr): x is string => !!x && arr.indexOf(x) === i);
            const descricao = partes.join(' › ');
            return { codigo: `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`, texto: normalizar(descricao), descricao };
          });
        return { folhas };
      })
      .catch((e) => {
        tabela = null; // tenta de novo na próxima busca
        throw e;
      });
  }
  return tabela;
}

// palavra -> raiz simples (tira plural) para "biscoitos" achar "biscoito"
const raiz = (p: string) => p.replace(/(oes|aes|ais|eis|es|s)$/, '');

export async function buscarNcm(nomeProduto: string, limite = 6): Promise<NcmSugestao[]> {
  const palavras = normalizar(nomeProduto)
    .split(/[^a-z]+/)
    .filter((p) => p.length >= 3)
    .map(raiz)
    .filter((p) => p.length >= 3);
  if (!palavras.length) return [];
  const { folhas } = await carregarTabela();
  const res: { s: number; f: (typeof folhas)[number] }[] = [];
  for (const f of folhas) {
    let s = 0;
    palavras.forEach((p, i) => {
      if (f.texto.includes(p)) s += i === 0 ? 3 : 1; // a 1ª palavra do nome costuma ser o tipo do produto
    });
    if (s >= 3 || (s > 0 && palavras.length === 1)) res.push({ s, f });
  }
  res.sort((a, b) => b.s - a.s || a.f.descricao.length - b.f.descricao.length);
  return res.slice(0, limite).map(({ f }) => ({ codigo: f.codigo, descricao: f.descricao }));
}
