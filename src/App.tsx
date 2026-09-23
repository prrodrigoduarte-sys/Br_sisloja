import React, { useState } from 'react';
import PdvModule from './PdvModule';

export default function App() {
  const [activeTab, setActiveTab] = useState('pdv');
  
  const loggedUser = {
    nome_usuario: 'Operador Balcão',
    perfil: 'admin',
    codigo_loja: 'LOJA-01'
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#f1f5f9', fontFamily: 'sans-serif' }}>
      {/* Menu Lateral */}
      <div style={{ width: '260px', backgroundColor: '#0f172a', color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '20px' }}>
        <div>
          <div style={{ marginBottom: '25px', borderBottom: '1px solid #1e293b', paddingBottom: '15px' }}>
            <h1 style={{ fontSize: '22px', fontWeight: '900', color: '#fbbf24', margin: '0 0 4px 0', letterSpacing: '0.5px' }}>brloja</h1>
            <p style={{ fontSize: '11px', color: '#94a3b8', margin: 0, textTransform: 'uppercase', fontWeight: 'bold' }}>Gestão Inteligente</p>
          </div>
          
          <button 
            onClick={() => setActiveTab('pdv')}
            style={{ width: '100%', textAlign: 'left', padding: '12px 15px', backgroundColor: '#fbbf24', color: '#0f172a', fontWeight: 'bold', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '10px' }}
          >
            🛒 Frente de Caixa (PDV)
          </button>
        </div>

        <div style={{ fontSize: '11px', color: '#94a3b8', borderTop: '1px solid #1e293b', paddingTop: '15px' }}>
          Operador: <strong style={{ color: '#fff' }}>{loggedUser.nome_usuario}</strong>
        </div>
      </div>

      {/* Conteúdo Principal */}
      <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
        {activeTab === 'pdv' && <PdvModule loggedUser={loggedUser} />}
      </div>
    </div>
  );
}