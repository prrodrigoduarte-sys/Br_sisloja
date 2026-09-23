import React, { useState, useEffect } from 'react';
import { supabase } from './supabase';

export default function PdvModule({ loggedUser }: { loggedUser: any }) {
  const produtosExemplo = [
    { id: '1', sku: 'FER-01', nome: 'Martelo Unha Aço Forjado', estoque_atual: 15, preco_venda: 45.90 },
    { id: '2', sku: 'FER-02', nome: 'Chave de Fenda Isolada 1/4', estoque_atual: 30, preco_venda: 18.50 },
    { id: '3', sku: 'MAT-01', nome: 'Cimento CP II-E 50kg', estoque_atual: 120, preco_venda: 34.00 },
    { id: '4', sku: 'MAT-02', nome: 'Tubo PVC Esgoto 100mm', estoque_atual: 45, preco_venda: 62.00 },
  ];

  const [produtos, setProdutos] = useState<any[]>(produtosExemplo);
  const [busca, setBusca] = useState('');
  const [carrinho, setCarrinho] = useState<any[]>([]);
  const [formaPagamento, setFormaPagamento] = useState('dinheiro');
  const [valorRecebido, setValorRecebido] = useState('');
  const [loading, setLoading] = useState(false);
  const [modoSupabase, setModoSupabase] = useState(false);

  const codigoLoja = loggedUser?.codigo_loja || 'LOJA-01';

  useEffect(() => {
    const carregarProdutos = async () => {
      try {
        const { data, error } = await supabase
          .from('produtos')
          .select('*')
          .limit(50);
        
        if (!error && data && data.length > 0) {
          setProdutos(data);
          setModoSupabase(true);
        }
      } catch (err) {
        console.log('A usar modo local de segurança.');
      }
    };
    carregarProdutos();
  }, []);

  const produtosFiltrados = produtos.filter(
    (p) =>
      p.nome?.toLowerCase().includes(busca.toLowerCase()) ||
      p.sku?.toLowerCase().includes(busca.toLowerCase())
  );

  const adicionarAoCarrinho = (produto: any) => {
    setCarrinho((prev) => {
      const existe = prev.find((item) => item.id === produto.id);
      if (existe) {
        return prev.map((item) =>
          item.id === produto.id
            ? { ...item, quantidade: item.quantidade + 1, subtotal: (item.quantidade + 1) * item.preco_venda }
            : item
        );
      }
      return [...prev, { ...produto, quantidade: 1, subtotal: produto.preco_venda }];
    });
    setBusca('');
  };

  const removerDoCarrinho = (id: string) => {
    setCarrinho((prev) => prev.filter((item) => item.id !== id));
  };

  const totalGeral = carrinho.reduce((acc, item) => acc + item.subtotal, 0);
  const troco = Number(valorRecebido) > totalGeral ? Number(valorRecebido) - totalGeral : 0;

  const finalizarVenda = async () => {
    if (carrinho.length === 0) {
      alert('O carrinho está vazio!');
      return;
    }

    setLoading(true);
    try {
      if (modoSupabase) {
        await supabase.from('vendas').insert([
          {
            codigo_loja: codigoLoja,
            total: totalGeral,
            forma_pagamento: formaPagamento,
            operador: loggedUser?.nome_usuario || 'Balcão',
          },
        ]);
      }

      alert('✅ Venda finalizada com sucesso!');
      setCarrinho([]);
      setValorRecebido('');
    } catch (err: any) {
      alert('Erro ao finalizar venda: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', height: 'calc(100vh - 40px)' }}>
      {/* Lista de Produtos */}
      <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '15px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '900', color: '#1e293b', margin: 0 }}>🛒 Frente de Caixa (PDV)</h2>
          <span style={{ fontSize: '10px', fontWeight: 'bold', padding: '4px 8px', borderRadius: '6px', backgroundColor: modoSupabase ? '#dcfce7' : '#fef3c7', color: modoSupabase ? '#166534' : '#92400e' }}>
            {modoSupabase ? 'Supabase Conectado' : 'Modo Híbrido / Local'}
          </span>
        </div>

        <input
          type="text"
          placeholder="🔎 Pesquisar produto por nome ou código (SKU)..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none' }}
          autoFocus
        />

        <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', alignContent: 'start' }}>
          {produtosFiltrados.map((p) => (
            <div
              key={p.id}
              onClick={() => adicionarAoCarrinho(p)}
              style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '15px', borderRadius: '12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
            >
              <div>
                <p style={{ fontWeight: 'bold', fontSize: '13px', color: '#1e293b', margin: '0 0 5px 0' }}>{p.nome}</p>
                <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>Stock: {p.estoque_atual || 0}</p>
              </div>
              <p style={{ fontWeight: '900', fontSize: '15px', color: '#d97706', margin: '15px 0 0 0' }}>
                R$ {Number(p.preco_venda || 0).toFixed(2)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Carrinho / Resumo */}
      <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: '900', color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', margin: '0 0 15px 0' }}>Resumo da Venda Atual</h3>

          <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {carrinho.length === 0 ? (
              <p style={{ textAlign: 'center', fontSize: '12px', color: '#94a3b8', margin: '40px 0' }}>Nenhum item adicionado.</p>
            ) : (
              carrinho.map((item) => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', padding: '10px', borderRadius: '8px', fontSize: '12px' }}>
                  <div>
                    <p style={{ fontWeight: 'bold', margin: '0 0 2px 0', color: '#1e293b' }}>{item.nome}</p>
                    <p style={{ color: '#64748b', margin: 0 }}>{item.quantidade}x R$ {Number(item.preco_venda).toFixed(2)}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontWeight: '900', color: '#0f172a' }}>R$ {item.subtotal.toFixed(2)}</span>
                    <button onClick={() => removerDoCarrinho(item.id)} style={{ color: '#e11d48', background: 'none', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>✕</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '15px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: '#64748b', marginBottom: '5px' }}>FORMA DE PAGAMENTO</label>
            <select
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', backgroundColor: '#fff', fontWeight: 'bold' }}
            >
              <option value="dinheiro">Dinheiro</option>
              <option value="pix">Pix</option>
              <option value="cartao_credito">Cartão de Crédito</option>
              <option value="cartao_debito">Cartão de Débito</option>
            </select>
          </div>

          {formaPagamento === 'dinheiro' && (
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: '#64748b', marginBottom: '5px' }}>VALOR RECEBIDO (R$)</label>
              <input
                type="number"
                value={valorRecebido}
                onChange={(e) => setValorRecebido(e.target.value)}
                placeholder="0.00"
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', outline: 'none' }}
              />
              {troco > 0 && <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#059669', margin: '5px 0 0 0' }}>Troco: R$ {troco.toFixed(2)}</p>}
            </div>
          )}

          <div style={{ backgroundColor: '#0f172a', color: '#fff', padding: '15px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#94a3b8' }}>TOTAL A PAGAR</span>
            <span style={{ fontSize: '20px', fontWeight: '900', color: '#fbbf24' }}>R$ {totalGeral.toFixed(2)}</span>
          </div>

          <button
            onClick={finalizarVenda}
            disabled={loading}
            style={{ width: '100%', backgroundColor: '#fbbf24', color: '#0f172a', fontWeight: '900', padding: '14px', borderRadius: '12px', border: 'none', cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'A processar...' : '⚡ FINALIZAR VENDA [F10]'}
          </button>
        </div>
      </div>
    </div>
  );
}