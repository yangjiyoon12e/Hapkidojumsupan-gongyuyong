import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Peer } from 'peerjs';
import QRCode from 'react-qr-code';
import { Menu, History } from 'lucide-react';
import { useTournament } from './context/TournamentContext';

// --- Types ---
type PlayerColor = 'red' | 'blue';
type GameMode = 'hosinsul';

interface JudgeState {
  id: number;
  active: boolean;    
  vote: number | null; 
}

interface ScoreLog {
  id: number;
  time: string;
  round: number;
  message: string;
}

interface ButtonLog {
  id: number;
  time: string;
  message: string;
}

interface PlayerStats {
  name: string;
  region: string;
  score: number;
  gamjeom: number;
  kyonggo: number;
  disqualified: boolean;
}

// --- Constants ---
const POINT_GAP_LIMIT = 5;
const WARNING_DQ_LIMIT = 5;

const HosinsulScoreboardApp = () => {
  const navigate = useNavigate();
  const { updateMatchWinner } = useTournament();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const initialDashboardId = searchParams.get('dashboardId') || '';
  const initialCourtName = searchParams.get('courtName') || '제 1코트 (A)';

  // --- Game Settings & Info ---
  const [gameMode] = useState<GameMode>('hosinsul');
  const [tournamentName, setTournamentName] = useState("");
  const [matchNo, setMatchNo] = useState("1");
  const [weightClass, setWeightClass] = useState("일반부");
  
  const [roundDuration, setRoundDuration] = useState(120);
  const [currentRound, setCurrentRound] = useState(1);
  const [timeLeft, setTimeLeft] = useState(1200); 
  const [isRunning, setIsRunning] = useState(false);
  
  const [matchResult, setMatchResult] = useState<string | null>(null);
  
  const [matchInfo, setMatchInfo] = useState<{matchId: string, roundIndex: number, matchIndex: number, bracketDivision?: string, bracketWeight?: string, p1?: any, p2?: any} | null>(null);

  const [isScoreRevealed, setIsScoreRevealed] = useState(false);
  const [isEditingTournamentName, setIsEditingTournamentName] = useState(false);

  const dashboardConnRef = useRef<any>(null);
  const [redPlayer, setRedPlayer] = useState<PlayerStats>({
    name: '', region: '', score: 0, gamjeom: 0, kyonggo: 0, disqualified: false
  });
  const [bluePlayer, setBluePlayer] = useState<PlayerStats>({
    name: '', region: '', score: 0, gamjeom: 0, kyonggo: 0, disqualified: false
  });

  // Initialize from location state
  useEffect(() => {
    if (location.state) {
      const { p1, p2, matchId, roundIndex, matchIndex } = location.state as any;
      if (p1) setRedPlayer(prev => ({ ...prev, name: p1.name, region: p1.gym }));
      if (p2) setBluePlayer(prev => ({ ...prev, name: p2.name, region: p2.gym }));
      if (p1?.division && p1?.weightClass) setWeightClass(`${p1.division} ${p1.weightClass}`);
      if (matchId && roundIndex !== undefined && matchIndex !== undefined) {
          setMatchInfo({ matchId, roundIndex, matchIndex, bracketDivision: p1?.division, bracketWeight: p1?.weightClass, p1, p2 });
      }
    }
  }, [location.state]);

  // --- Judges State ---
  const [redJudges, setRedJudges] = useState<JudgeState[]>(Array.from({length: 5}, (_, i) => ({ id: i + 1, active: false, vote: null })));
  const [blueJudges, setBlueJudges] = useState<JudgeState[]>(Array.from({length: 5}, (_, i) => ({ id: i + 1, active: false, vote: null })));

  // --- Logs State ---
  const [logs, setLogs] = useState<ScoreLog[]>([]);
  const [buttonLogs, setButtonLogs] = useState<ButtonLog[]>([]);

  // --- Modal & View State ---
  const [showHistory, setShowHistory] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'host' | 'judge'>('host');
  const [isConnected, setIsConnected] = useState(false);
  
  const [mainDashboardId, setMainDashboardId] = useState(initialDashboardId);
  const [courtName, setCourtName] = useState(initialCourtName);
  
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<any>(null);
  const hostConnsRef = useRef<any[]>([]);

  const [remoteGameMode, setRemoteGameMode] = useState<GameMode>('hosinsul');
  const [hostState, setHostState] = useState<any>(null);

  // Auto-initialize judge mode from URL params
  useEffect(() => {
    const v = searchParams.get('v');
    const h = searchParams.get('h');
    const j = searchParams.get('j');
    if (v === 'judge' && h && j) {
        setViewMode('judge');
        setTargetHostId(h);
        setJudgeId(parseInt(j));
    }
  }, []);

  const [targetHostId, setTargetHostId] = useState('');
  const [judgeId, setJudgeId] = useState<number | null>(null);

  // --- PeerJS Logic ---
  useEffect(() => {
    const peer = new Peer();
    peer.on('open', setMyPeerId);
    
    peer.on('connection', (conn) => {
        conn.on('open', () => {
            hostConnsRef.current.push(conn);
            conn.send({ type: 'gamemode', mode: 'hosinsul' });
            // Send initial state
            conn.send({ type: 'state_update', state: {
                red: redPlayer, blue: bluePlayer, timeLeft, isRunning, currentRound, matchResult, gameMode,
                isScoreRevealed, redJudges, blueJudges
            }});
        });
        conn.on('data', (data: any) => {
            if (data.type === 'vote') handleElectronicVote(data.color, data.judgeId);
            if (data.type === 'register') addLog(`부심 ${data.judgeId} 연결됨`);
        });
        conn.on('close', () => {
            hostConnsRef.current = hostConnsRef.current.filter(c => c !== conn);
        });
    });
    peerRef.current = peer;
    return () => peer.destroy();
  }, []);

  const connectToHost = () => {
      if (!peerRef.current || !targetHostId || !judgeId) return;
      const conn = peerRef.current.connect(targetHostId);
      conn.on('open', () => {
          setIsConnected(true);
          conn.send({ type: 'register', judgeId });
          connRef.current = conn;
      });
      conn.on('data', (data: any) => {
          if (data.type === 'gamemode') setRemoteGameMode(data.mode);
          if (data.type === 'state_update') setHostState(data.state);
      });
      conn.on('close', () => setIsConnected(false));
  };

  const sendVote = (color: 'red' | 'blue') => {
      if (!connRef.current) return;
      if (navigator.vibrate) navigator.vibrate(50);
      connRef.current.send({ type: 'vote', color, judgeId });
  };

  const [remoteJudgesArr, setRemoteJudgesArr] = useState<{red: boolean, blue: boolean}>({red: false, blue: false});
  useEffect(() => {
      if (hostState && judgeId) {
          const rActive = hostState.redJudges.find((j: any) => j.id === judgeId)?.active;
          const bActive = hostState.blueJudges.find((j: any) => j.id === judgeId)?.active;
          setRemoteJudgesArr({red: !!rActive, blue: !!bActive});
      }
  }, [hostState, judgeId]);

  if (viewMode === 'judge') {
    return (
        <div style={{...styles.appContainer, padding:'20px', alignItems:'center'}}>
            <h2 style={{color:'white'}}>부심 리모컨 (Hosinsul Remote)</h2>
            {!isConnected ? (
                <div style={{display:'flex', flexDirection:'column', gap:'15px', width:'100%', maxWidth:'400px'}}>
                    <input placeholder="호스트 ID" value={targetHostId} onChange={e => setTargetHostId(e.target.value)} style={styles.modalInput} />
                    <div style={{display:'flex', gap:'10px', justifyContent:'center'}}>
                        {[1, 2, 3, 4, 5].map(id => (
                            <button key={id} onClick={() => setJudgeId(id)} style={{...styles.subActionBtn, background: judgeId === id ? '#FFD700' : '#333', color: judgeId === id ? '#000' : '#fff'}}>{id}</button>
                        ))}
                    </div>
                    <button onClick={connectToHost} disabled={!targetHostId || !judgeId} style={styles.mainActionBtn}>연결하기</button>
                    <button onClick={() => setViewMode('host')} style={styles.subActionBtn}>메인으로</button>
                </div>
            ) : (
                <div style={{display:'flex', flexDirection:'column', width:'100%', height:'80%', gap:'20px'}}>
                    <div style={{textAlign:'center', fontSize:'1.2rem', color:'#FFD700'}}>부심 {judgeId} 연결됨</div>
                    <div style={{flex:1, display:'flex', gap:'20px'}}>
                        <button 
                          onPointerDown={(e) => { e.preventDefault(); sendVote('red'); }}
                          style={{...styles.remoteBtn, background: remoteJudgesArr.red ? '#f00' : '#400', border: '5px solid #f00'}}
                        >
                          홍 (RED)
                        </button>
                        <button 
                          onPointerDown={(e) => { e.preventDefault(); sendVote('blue'); }}
                          style={{...styles.remoteBtn, background: remoteJudgesArr.blue ? '#00f' : '#003', border: '5px solid #00f'}}
                        >
                          청 (BLUE)
                        </button>
                    </div>
                    <button onClick={() => { connRef.current?.close(); setIsConnected(false); }} style={styles.subActionBtn}>연결 종료</button>
                </div>
            )}
        </div>
    );
  }

  const handleElectronicVote = (color: PlayerColor, judgeId: number) => {
      const setJudges = color === 'red' ? setRedJudges : setBlueJudges;
      setJudges(prev => prev.map(j => j.id === judgeId ? { ...j, active: !j.active } : j));
      addLog(`${color === 'red' ? '홍' : '청'} 부심 ${judgeId} 채점 변경`);
  };

  const addLog = (msg: string) => {
    setLogs(prev => [{
      id: Date.now() + Math.random(),
      time: '0:00',
      round: currentRound,
      message: msg
    }, ...prev]);
  };

  // --- Hosinsul Score Calculation ---
  useEffect(() => {
    const rScore = redJudges.filter(j => j.active).length;
    const bScore = blueJudges.filter(j => j.active).length;
    setRedPlayer(prev => ({ ...prev, score: rScore }));
    setBluePlayer(prev => ({ ...prev, score: bScore }));
  }, [redJudges, blueJudges]);

  const resetMatch = () => {
      if (!window.confirm("경기를 초기화하시겠습니까?")) return;
      setRedPlayer(p => ({ ...p, score: 0 }));
      setBluePlayer(p => ({ ...p, score: 0 }));
      setRedJudges(prev => prev.map(j => ({ ...j, active: false })));
      setBlueJudges(prev => prev.map(j => ({ ...j, active: false })));
      setMatchResult(null);
      setIsScoreRevealed(false);
      setLogs([]);
  };

  const broadcastState = () => {
      const state = {
          red: redPlayer, blue: bluePlayer, timeLeft, isRunning, currentRound, matchResult, gameMode,
          isScoreRevealed, redJudges, blueJudges
      };
      hostConnsRef.current.forEach(conn => {
          if (conn.open) conn.send({ type: 'state_update', state });
      });
      if (dashboardConnRef.current?.open) {
          dashboardConnRef.current.send({ type: 'court_state', state });
      }
  };

  useEffect(() => {
      broadcastState();
  }, [redPlayer, bluePlayer, matchResult, isScoreRevealed]);

  return (
    <div style={styles.appContainer}>
      <div style={styles.headerBoard}>
        <button onClick={() => navigate('/')} style={styles.homeBtn}>메뉴</button>
        <button onClick={() => setShowHistory(true)} style={styles.logBtn}>채점 기록</button>
        
        <div style={{ textAlign: 'center', marginTop: '10px' }}>
          <h1 
            style={{ fontSize: '1.2rem', margin: 0, cursor: 'pointer', color: '#888' }}
            onClick={() => setIsEditingTournamentName(true)}
          >
            {isEditingTournamentName ? (
              <input 
                autoFocus
                value={tournamentName}
                onChange={e => setTournamentName(e.target.value)}
                onBlur={() => setIsEditingTournamentName(false)}
                onKeyDown={e => e.key === 'Enter' && setIsEditingTournamentName(false)}
                style={{ background: '#222', color: '#fff', border: '1px solid #444', textAlign: 'center' }}
              />
            ) : (tournamentName || '제 1회 합기도 대회')}
          </h1>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#FFD700', marginTop: '5px' }}>
            {weightClass} | {matchNo}경기
          </div>
        </div>

        <button 
           onClick={() => setShowConnectModal(true)}
           style={{...styles.modeToggleBtn, right: '10px'}}
        >
          무선 연결 📶
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
         <div style={{ ...styles.playerCard, background: '#D00' }}>
              <div style={styles.bigScore}>{isScoreRevealed ? redPlayer.score : '0'}</div>
              <div style={styles.playerInfoBox}>
                  <input value={redPlayer.name} onChange={e => setRedPlayer({...redPlayer, name: e.target.value})} style={styles.playerName} placeholder="RED 선수명"/>
                  <input value={redPlayer.region} onChange={e => setRedPlayer({...redPlayer, region: e.target.value})} style={styles.playerRegion} placeholder="소속"/>
              </div>
         </div>

         <div style={{...styles.playerCard, background: '#0047BB'}}>
              <div style={styles.bigScore}>{isScoreRevealed ? bluePlayer.score : '0'}</div>
              <div style={styles.playerInfoBox}>
                  <input value={bluePlayer.name} onChange={e => setBluePlayer({...bluePlayer, name: e.target.value})} style={styles.playerName} placeholder="BLUE 선수명"/>
                  <input value={bluePlayer.region} onChange={e => setBluePlayer({...bluePlayer, region: e.target.value})} style={styles.playerRegion} placeholder="소속"/>
              </div>
         </div>

         <div style={styles.centerOverlay}>
              <div style={styles.timerBox}>HOSINSUL</div>
              {matchResult && <div style={styles.resultBanner}>{matchResult}</div>}
         </div>
      </div>

      <div style={styles.controlPanel}>
        <div style={styles.controlGroupRed}>
            <div style={styles.controlHeader}>홍 채점 판정</div>
            <div style={{display:'flex', flexWrap:'wrap', gap:'5px', flex:1}}>
                {redJudges.map(j => (
                    <button 
                      key={j.id}
                      onClick={() => handleElectronicVote('red', j.id)}
                      style={{...styles.judgeBtn, background: j.active ? '#ff0' : '#400', color: j.active ? '#000' : '#fff'}}
                    >
                      부심 {j.id}
                    </button>
                ))}
            </div>
        </div>

        <div style={styles.controlGroupCenter}>
            <div style={styles.controlHeader}>경기 제어</div>
            <div style={{display:'flex', flexDirection:'column', gap: '10px', width: '100%', flex:1}}>
                <button 
                  onClick={() => setIsScoreRevealed(!isScoreRevealed)} 
                  style={{...styles.mainActionBtn, background: isScoreRevealed ? '#fff' : '#FFD700'}}
                >
                  {isScoreRevealed ? '점수 숨기기' : '합산 점수 공개'}
                </button>
                <div style={{display:'flex', gap:'5px'}}>
                    <button onClick={resetMatch} style={styles.subActionBtn}>초기화</button>
                    <button onClick={() => {
                        const winner = redPlayer.score > bluePlayer.score ? "홍 승" : bluePlayer.score > redPlayer.score ? "청 승" : "무승부";
                        setMatchResult(winner);
                        setIsScoreRevealed(true);
                    }} style={styles.subActionBtn}>경기종료</button>
                </div>
            </div>
        </div>

        <div style={styles.controlGroupBlue}>
            <div style={styles.controlHeader}>청 채점 판정</div>
            <div style={{display:'flex', flexWrap:'wrap', gap:'5px', flex:1}}>
                {blueJudges.map(j => (
                    <button 
                      key={j.id}
                      onClick={() => handleElectronicVote('blue', j.id)}
                      style={{...styles.judgeBtn, background: j.active ? '#ff0' : '#003', color: j.active ? '#000' : '#fff'}}
                    >
                      부심 {j.id}
                    </button>
                ))}
            </div>
        </div>
      </div>

      {showConnectModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <h3 style={{margin:0, color:'#FFD700'}}>무선 채점기 연결 (Wireless Connect)</h3>
              <button onClick={() => setShowConnectModal(false)} style={styles.closeBtn}>X</button>
            </div>
            
            <div style={{background:'#fff3cd', color:'#856404', padding:'12px', borderRadius:'8px', marginBottom:'15px', border:'2px solid #dc3545', fontSize:'0.95rem', width:'100%', textAlign:'left', fontWeight:'bold'}}>
              <b>🚨 필독: 부심 로그인 창 해결 방법</b><br/>
              부심 스마트폰으로 QR 스캔 시 <b>AI Studio 로그인</b>이 뜨면 안 됩니다!<br/>
              반드시 현재 화면 우측 상단의 <span style={{color:'#dc3545', textDecoration:'underline'}}>['새 창에서 열기' (Open in new tab)]</span> 아이콘을 클릭하여 페이지를 새로 연 후, 다시 QR을 생성하여 스캔해 주세요.
            </div>
            
            <div style={{background:'#000', padding:'10px', fontSize:'1.2rem', fontWeight:'bold', textAlign:'center', color:'#FFD700', border:'1px solid #444', marginBottom:'15px', width:'100%'}}>
                ID: {myPeerId || "생성 중..."}
            </div>

            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:'12px', justifyContent:'center', width:'100%'}}>
              {[1, 2, 3, 4, 5].map(id => {
                  const qrUrl = `${window.location.origin}/hosinsul-scoreboard?v=judge&h=${myPeerId}&j=${id}`;
                  return (
                      <div key={id} style={{
                          background: '#111', padding: '15px 5px', borderRadius: '8px', 
                          border: '1px solid #444', 
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px'
                      }}>
                          <div style={{fontSize: '0.9rem', fontWeight: 'bold', color: '#fff'}}>부심 {id}</div>
                          {myPeerId ? (
                              <div style={{background:'#fff', padding:'5px', borderRadius:'5px', display:'flex', justifyContent:'center', alignItems:'center', width:'110px', height:'110px'}}>
                                    <QRCode value={qrUrl} size={100} />
                              </div>
                          ) : (
                              <div style={{color: '#888', fontSize: '0.75rem', height: '110px', display:'flex', alignItems:'center'}}>생성 중...</div>
                          )}
                      </div>
                  );
              })}
            </div>

            <button onClick={() => setShowConnectModal(false)} style={{...styles.mainActionBtn, marginTop:'20px'}}>닫기</button>
          </div>
        </div>
      )}

      {showHistory && (
        <div style={styles.modalOverlay} onClick={() => setShowHistory(false)}>
            <div style={{...styles.modalContent, width: '90%', maxWidth:'600px'}} onClick={e => e.stopPropagation()}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #333', paddingBottom:'10px', marginBottom:'20px'}}>
                    <h2 style={{margin:0}}>채점 기록</h2>
                    <button onClick={() => setShowHistory(false)} style={{background:'none', border:'none', color:'#ccc', fontSize:'1.5rem', cursor:'pointer'}}>✕</button>
                </div>
                <div style={{maxHeight:'400px', overflowY:'auto'}}>
                    {logs.map(log => (
                        <div key={log.id} style={{padding:'8px', borderBottom:'1px solid #222', fontSize:'0.9rem', color:'#ccc'}}>
                            [{log.time}] {log.message}
                        </div>
                    ))}
                    {logs.length === 0 && <div style={{textAlign:'center', color:'#555', padding:'40px'}}>기록이 없습니다.</div>}
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  appContainer: {
    display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#000', color: 'white', overflow: 'hidden'
  },
  headerBoard: {
    height: '100px', backgroundColor: '#111', display: 'flex', flexDirection: 'column', position: 'relative', borderBottom: '2px solid #333'
  },
  homeBtn: { position: 'absolute', top: '10px', left: '10px', background: '#333', color: 'white', border: '1px solid #555', cursor: 'pointer', padding: '5px 10px', borderRadius: '5px' },
  logBtn: { position: 'absolute', top: '50px', left: '10px', background: '#333', color: 'white', border: '1px solid #555', cursor: 'pointer', padding: '5px 10px', borderRadius: '5px' },
  modeToggleBtn: { position: 'absolute', top: '10px', right: '10px', background: '#333', color: '#ff0', border: '1px solid #ff0', cursor: 'pointer', padding: '8px 15px', borderRadius: '20px', fontWeight: 'bold' },
  playerCard: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  bigScore: { fontSize: '15rem', fontWeight: 'bold', fontFamily: 'monospace' },
  playerInfoBox: { position: 'absolute', bottom: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '80%' },
  playerName: { background: 'transparent', border: 'none', color: 'white', fontSize: '2.5rem', fontWeight: 'bold', textAlign: 'center', width: '100%', outline: 'none' },
  playerRegion: { background: 'transparent', border: 'none', color: '#ccc', fontSize: '1.2rem', textAlign: 'center', width: '100%', outline: 'none' },
  centerOverlay: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 20 },
  timerBox: { backgroundColor: 'black', color: '#ff0', border: '2px solid #ff0', padding: '10px 30px', fontSize: '3rem', fontWeight: 'bold' },
  resultBanner: { marginTop: '20px', background: '#fff', color: '#d00', padding: '10px 20px', fontSize: '2rem', fontWeight: '900', border: '5px solid #d00' },
  controlPanel: { height: '250px', backgroundColor: '#181818', borderTop: '4px solid #333', display: 'flex', padding: '10px', gap: '10px' },
  controlGroupRed: { flex: 1, backgroundColor: '#200', padding: '10px', borderRadius: '8px', display: 'flex', flexDirection: 'column' },
  controlGroupBlue: { flex: 1, backgroundColor: '#001', padding: '10px', borderRadius: '8px', display: 'flex', flexDirection: 'column' },
  controlGroupCenter: { flex: 1, backgroundColor: '#222', padding: '10px', borderRadius: '8px', display: 'flex', flexDirection: 'column' },
  controlHeader: { fontSize: '0.9rem', color: '#aaa', marginBottom: '10px', textAlign: 'center', borderBottom: '1px solid #333' },
  judgeBtn: { flex: '1 0 45%', padding: '10px', cursor: 'pointer', border: '1px solid #555', borderRadius: '4px', fontWeight: 'bold' },
  mainActionBtn: { width: '100%', padding: '15px', fontSize: '1.2rem', fontWeight: 'bold', borderRadius: '8px', border: 'none', cursor: 'pointer' },
  subActionBtn: { flex: 1, padding: '10px', background: '#333', color: '#ccc', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: '#1a1a1a', padding: '40px', borderRadius: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', border: '1px solid #333' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '20px', borderBottom: '1px solid #333', paddingBottom: '10px' },
  closeBtn: { background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' },
  modalInput: { width: '100%', padding: '12px', background: '#333', border: '1px solid #555', color: '#fff', borderRadius: '8px', fontSize: '1.1rem' }
};

export default HosinsulScoreboardApp;
