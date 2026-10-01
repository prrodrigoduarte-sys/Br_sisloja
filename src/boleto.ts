// BR Sisloja - Fase 3 - Leitura de boleto (linha digitável ou código de barras)
// Boleto bancário: 47 dígitos (linha digitável) ou 44 (código de barras) -> banco, vencimento e valor.
// Conta de consumo/tributo (começa com 8): 48 dígitos (linha) ou 44 (barras) -> valor (sem vencimento padrão).

export type Boleto = {
    tipo: 'bancario' | 'arrecadacao';
    codigo_barras: string; // 44 dígitos
    linha_digitavel: string; // 47 (bancário) ou 48 (arrecadação) dígitos
    banco: string;
    vencimento: string | null; // AAAA-MM-DD
    valor: number;
    dv_ok: boolean; // dígito verificador geral confere
  };
  
  const BANCOS: Record<string, string> = {
    '001': 'Banco do Brasil',
    '004': 'Banco do Nordeste',
    '033': 'Santander',
    '041': 'Banrisul',
    '070': 'BRB',
    '077': 'Inter',
    '085': 'Ailos',
    '104': 'Caixa',
    '136': 'Unicred',
    '208': 'BTG Pactual',
    '212': 'Original',
    '237': 'Bradesco',
    '260': 'Nubank',
    '336': 'C6 Bank',
    '341': 'Itaú',
    '389': 'Mercantil',
    '399': 'HSBC',
    '422': 'Safra',
    '655': 'Votorantim',
    '707': 'Daycoval',
    '745': 'Citibank',
    '748': 'Sicredi',
    '756': 'Sicoob',
  };
  
  const digitos = (s: string) => (s || '').replace(/\D/g, '');
  
  // módulo 10: pesos 2,1,2,1... da direita para a esquerda
  function mod10(num: string) {
    let soma = 0;
    let peso = 2;
    for (let i = num.length - 1; i >= 0; i--) {
      let p = parseInt(num[i], 10) * peso;
      if (p > 9) p = Math.floor(p / 10) + (p % 10);
      soma += p;
      peso = peso === 2 ? 1 : 2;
    }
    return (10 - (soma % 10)) % 10;
  }
  
  // módulo 11: pesos 2..9 da direita para a esquerda
  function soma11(num: string) {
    let soma = 0;
    let peso = 2;
    for (let i = num.length - 1; i >= 0; i--) {
      soma += parseInt(num[i], 10) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    return soma;
  }
  
  function dvBancario(barras: string) {
    const dv = 11 - (soma11(barras.slice(0, 4) + barras.slice(5)) % 11);
    return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
  }
  
  function dvArrecadacao(barras: string) {
    const base = barras.slice(0, 3) + barras.slice(4);
    const ref = barras[2];
    if (ref === '6' || ref === '7') return mod10(base);
    const r = soma11(base) % 11;
    return r === 0 || r === 1 ? 0 : r === 10 ? 1 : 11 - r;
  }
  
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  
  // Fator de vencimento: dias desde 07/10/1997. Ao chegar em 9999 (21/02/2025) voltou para 1000 (22/02/2025).
  // Escolhe a data mais próxima de hoje entre os dois ciclos.
  export function dataDoFator(fator: number): string | null {
    if (!fator) return null;
    const dia = 86400000;
    const antigo = Date.UTC(1997, 9, 7) + fator * dia;
    const novo = Date.UTC(2025, 1, 22) + (fator - 1000) * dia;
    const hoje = Date.now();
    return iso(new Date(Math.abs(novo - hoje) < Math.abs(antigo - hoje) ? novo : antigo));
  }
  
  function linhaParaBarrasBancario(l: string) {
    return l.slice(0, 4) + l.slice(32, 33) + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
  }
  
  function barrasParaLinhaBancario(b: string) {
    const c1 = b.slice(0, 4) + b.slice(19, 24);
    const c2 = b.slice(24, 34);
    const c3 = b.slice(34, 44);
    return c1 + mod10(c1) + c2 + mod10(c2) + c3 + mod10(c3) + b[4] + b.slice(5, 19);
  }
  
  function barrasParaLinhaArrecadacao(b: string) {
    const ref = b[2];
    let linha = '';
    for (let i = 0; i < 4; i++) {
      const bloco = b.slice(i * 11, i * 11 + 11);
      const dv = ref === '6' || ref === '7' ? mod10(bloco) : (() => {
        const r = soma11(bloco) % 11;
        return r === 0 || r === 1 ? 0 : r === 10 ? 1 : 11 - r;
      })();
      linha += bloco + dv;
    }
    return linha;
  }
  
  export function lerBoleto(texto: string): Boleto {
    const d = digitos(texto);
  
    if (d[0] === '8' && (d.length === 44 || d.length === 48)) {
      const barras = d.length === 48 ? [0, 1, 2, 3].map((i) => d.slice(i * 12, i * 12 + 11)).join('') : d;
      const ref = barras[2];
      const valorReal = ref === '6' || ref === '8';
      return {
        tipo: 'arrecadacao',
        codigo_barras: barras,
        linha_digitavel: d.length === 48 ? d : barrasParaLinhaArrecadacao(barras),
        banco: 'Conta de consumo / tributo',
        vencimento: null,
        valor: valorReal ? parseInt(barras.slice(4, 15), 10) / 100 : 0,
        dv_ok: dvArrecadacao(barras) === parseInt(barras[3], 10),
      };
    }
  
    if (d.length === 47 || d.length === 44) {
      const barras = d.length === 47 ? linhaParaBarrasBancario(d) : d;
      const codBanco = barras.slice(0, 3);
      return {
        tipo: 'bancario',
        codigo_barras: barras,
        linha_digitavel: d.length === 47 ? d : barrasParaLinhaBancario(barras),
        banco: `${codBanco} - ${BANCOS[codBanco] || 'Banco'}`,
        vencimento: dataDoFator(parseInt(barras.slice(5, 9), 10)),
        valor: parseInt(barras.slice(9, 19), 10) / 100,
        dv_ok: dvBancario(barras) === parseInt(barras[4], 10),
      };
    }
  
    throw new Error(
      `O código tem ${d.length} números. A linha digitável do boleto tem 47 (contas de consumo: 48) e o código de barras tem 44.`
    );
  }
  
  // 23793.38128 60000.000003 00000.000400 1 84340000010000
  export function formatarLinha(linha: string) {
    const l = digitos(linha);
    if (l.length === 47) {
      return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
    }
    if (l.length === 48) return [0, 1, 2, 3].map((i) => `${l.slice(i * 12, i * 12 + 11)}-${l[i * 12 + 11]}`).join(' ');
    return linha || '';
  }