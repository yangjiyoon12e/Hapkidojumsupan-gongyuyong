import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function Launcher() {
  const navigate = useNavigate();

  const containerStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    height: '100vh', overflowY: 'auto', background: '#000', color: 'white', fontFamily: '"Noto Sans KR", sans-serif',
    padding: '40px 20px'
  };

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '30px',
    maxWidth: '800px',
    width: '100%',
    marginTop: '50px'
  };

  const buttonStyle: React.CSSProperties = {
    width: '100%', padding: '50px 30px', fontSize: '1.6rem', fontWeight: 'bold',
    cursor: 'pointer', borderRadius: '20px', border: '2px solid #333',
    background: 'linear-gradient(145deg, #1f1f1f, #111111)', color: '#fff', 
    transition: 'all 0.3s ease', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '25px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)'
  };

  const subTextStyle: React.CSSProperties = {
    fontSize: '1rem',
    color: '#888',
    fontWeight: 'normal',
    marginTop: '-5px'
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.borderColor = '#FFD700';
    e.currentTarget.style.transform = 'translateY(-8px)';
    e.currentTarget.style.boxShadow = '0 15px 35px rgba(255, 215, 0, 0.25)';
    e.currentTarget.style.background = 'linear-gradient(145deg, #2a2a2a, #151515)';
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.borderColor = '#333';
    e.currentTarget.style.transform = 'translateY(0)';
    e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.6)';
    e.currentTarget.style.background = 'linear-gradient(145deg, #1f1f1f, #111111)';
  };

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '3.8rem', margin: '0', color: '#FFD700', fontFamily: 'Oswald', letterSpacing: '3px', fontWeight: 900 }}>HAPKIDO SCORE</h1>
          <h2 style={{ fontSize: '1.8rem', margin: '15px 0 5px 0', fontWeight: '400', color: '#eee' }}>합기도 전문 채점 점수판</h2>
          <p style={{ color: '#888', margin: '0', fontSize: '1rem' }}>대련 및 호신술 경기를 위한 공식 모바일/PC 전자 점수판 시스템</p>
      </div>
      
      <div style={gridStyle}>
        <button 
          onClick={() => navigate('/scoreboard')} 
          style={buttonStyle} 
          onMouseEnter={handleMouseEnter} 
          onMouseLeave={handleMouseLeave}
        >
          <span style={{ fontSize: '4.5rem' }}>🏆</span>
          대련 점수판
          <span style={subTextStyle}>겨루기 경기 전용 전자 채점기</span>
        </button>

        <button 
          onClick={() => navigate('/hosinsul-scoreboard')} 
          style={buttonStyle} 
          onMouseEnter={handleMouseEnter} 
          onMouseLeave={handleMouseLeave}
        >
          <span style={{ fontSize: '4.5rem' }}>🥋</span>
          호신술 점수판
          <span style={subTextStyle}>호신술 및 기술 경연 전용 전자 채점기</span>
        </button>
      </div>

      <div style={{ marginTop: '80px', color: '#444', fontSize: '0.9rem', letterSpacing: '1px' }}>
        © 2026 HAPKIDO ELECTRONIC SCOREBOARD SYSTEM
      </div>
    </div>
  );
}
