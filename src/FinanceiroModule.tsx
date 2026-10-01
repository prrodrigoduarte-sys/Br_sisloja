// BR Sisloja - Fase 3 - Financeiro: Contas a Pagar, Contas a Receber e Caixa na mesma aba
import React, { useState } from 'react';
import ContasPagarModule from './ContasPagarModule';

type Usuario = { id: string; email: string; nome: string; perfil: string; codigo_loja: string; loja_nome: string };
type Sub = 'pagar' | 'receber' | 'caixa';

const SUBS: { id: Sub; rotulo: string }[] = [
  { id: 'pagar', rotulo: '📤 Contas a Pagar' },
  { id: 'receber', rotulo: '📥 Contas a Receber' },
  { id: 'caixa', rotulo: '💵 Caixa' },
];

export default function FinanceiroModule({ loggedUser }: { loggedUser: Usuario }) {
  const [sub, setSub] = useState<Sub>('pagar');

  return (
    <div className="mx-auto max-w-7xl p-3 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-bold text-gray-800">💰 Financeiro</h2>
        {SUBS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            className={`rounded-lg px-3 py-2 text-sm ${sub === s.id ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {s.rotulo}
          </button>
        ))}
      </div>
      {sub === 'pagar' && <ContasPagarModule loggedUser={loggedUser} />}
      {sub === 'receber' && <EmBreve texto="Contas a Receber" />}
      {sub === 'caixa' && <EmBreve texto="Caixa" />}
    </div>
  );
}

function EmBreve({ texto }: { texto: string }) {
  return <div className="rounded-xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm">{texto}: em construção.</div>;
}
