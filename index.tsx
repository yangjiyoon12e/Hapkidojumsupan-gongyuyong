import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Peer } from 'peerjs';
import QRCode from 'react-qr-code';
import { Video, Menu, History } from 'lucide-react';
import Launcher from './Launcher';
import HosinsulScoreboardApp from './HosinsulScoreboardApp';
import { TournamentProvider, useTournament } from './context/TournamentContext';
import { GoogleGenAI, Type } from "@google/genai";

// --- Types ---
type PlayerColor = 'red' | 'blue';
type GameMode = 'sparring' | 'hosinsul';

interface JudgeState {
  id: number;
  active: boolean;    // Sparring: Manual toggle / Hosinsul: Vote state
  vote: number | null; // Electronic vote state (1 or 2)
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
const VOTE_WINDOW_MS = 750;

const ScoreboardApp = () => {
  const navigate = useNavigate();
  const { updateMatchWinner } = useTournament();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const initialDashboardId = searchParams.get('dashboardId') || '';
  const initialCourtName = searchParams.get('courtName') || '제 1코트 (A)';

  // --- Game Settings & Info ---
  const [gameMode, setGameMode] = useState<GameMode>('sparring');
  const [tournamentName, setTournamentName] = useState("");
  const [matchNo, setMatchNo] = useState("1");
  const [weightClass, setWeightClass] = useState("일반부");
  
  const [roundDuration, setRoundDuration] = useState(120);
  const [currentRound, setCurrentRound] = useState(1);
  const [timeLeft, setTimeLeft] = useState(1200); 
  const [isRunning, setIsRunning] = useState(false);
  const [isResting, setIsResting] = useState(false);
  const [restTimeLeft, setRestTimeLeft] = useState(300);
  const [timerMode, setTimerMode] = useState<'rest' | 'decision' | 'firstToScore'>('rest');
  
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [isManualOverride, setIsManualOverride] = useState(false);
  
  // Bracket Match Info
  const [matchInfo, setMatchInfo] = useState<{matchId: string, roundIndex: number, matchIndex: number, bracketDivision?: string, bracketWeight?: string, p1?: any, p2?: any, isFirstToScore?: boolean} | null>(null);

  // Hosinsul Reveal State
  const [isScoreRevealed, setIsScoreRevealed] = useState(false);
  const [isEditingTournamentName, setIsEditingTournamentName] = useState(false);

  // Score Consensus State
  const [pendingScore, setPendingScore] = useState<{color: PlayerColor, points: number, judges: number[]} | null>(null);

  const dashboardConnRef = useRef<any>(null);
  const [redPlayer, setRedPlayer] = useState<PlayerStats>({
    name: '', region: '', score: 0, gamjeom: 0, kyonggo: 0, disqualified: false
  });
  const [bluePlayer, setBluePlayer] = useState<PlayerStats>({
    name: '', region: '', score: 0, gamjeom: 0, kyonggo: 0, disqualified: false
  });

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

  // Initialize from location state (Bracket App)
  useEffect(() => {
    if (location.state) {
      const { p1, p2, matchId, roundIndex, matchIndex, isFirstToScore } = location.state as any;
      if (p1) {
        setRedPlayer(prev => ({ ...prev, name: p1.name, region: p1.gym }));
      }
      if (p2) {
        setBluePlayer(prev => ({ ...prev, name: p2.name, region: p2.gym }));
      }
      // Also set weight class if available in p1
      if (p1 && p1.division && p1.weightClass) {
          setWeightClass(`${p1.division} ${p1.weightClass}`);
      }
      if (matchId && roundIndex !== undefined && matchIndex !== undefined) {
          setMatchInfo({ matchId, roundIndex, matchIndex, bracketDivision: p1?.division, bracketWeight: p1?.weightClass, p1, p2, isFirstToScore });
      }
      if (isFirstToScore) {
        setTimerMode('firstToScore');
        setRoundDuration(60);
        setTimeLeft(600);
        setCurrentRound(3);
      }
    }
  }, [location.state]);

  const handleConfirmWinner = () => {
    // Simplified: Just clear result or stay on page
    setMatchResult(null);
  };

  // --- Judges State ---
  const [redJudges, setRedJudges] = useState<JudgeState[]>([
      { id: 1, active: false, vote: null },
      { id: 2, active: false, vote: null },
      { id: 3, active: false, vote: null },
      { id: 4, active: false, vote: null },
      { id: 5, active: false, vote: null },
  ]);
  const [blueJudges, setBlueJudges] = useState<JudgeState[]>([
      { id: 1, active: false, vote: null },
      { id: 2, active: false, vote: null },
      { id: 3, active: false, vote: null },
      { id: 4, active: false, vote: null },
      { id: 5, active: false, vote: null },
  ]);
  const votesRef = useRef<{ red: (number | null)[], blue: (number | null)[] }>({
      red: [null, null, null, null, null],
      blue: [null, null, null, null, null]
  });

  // --- Logs State ---
  const [logs, setLogs] = useState<ScoreLog[]>([]);
  const [buttonLogs, setButtonLogs] = useState<ButtonLog[]>([]);

  // --- Modal & View State ---
  const [showHistory, setShowHistory] = useState(false);
  const [historyTab, setHistoryTab] = useState<'score' | 'input' | 'ai'>('score');
  
  // Wireless / PeerJS State
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'host' | 'judge'>('host');
  // Check connections for judges 1-5
  const [judgeConnectionStatus, setJudgeConnectionStatus] = useState<Record<number, boolean>>({ 1: false, 2: false, 3: false, 4: false, 5: false });

  // Button Check Mode State
  const [showButtonCheckModal, setShowButtonCheckModalState] = useState(false);
  const showButtonCheckRef = useRef(false);
  const [buttonCheckState, setButtonCheckState] = useState<Record<string, boolean>>({}); 

  // Judge Mode State (Remote Side)
  const [targetHostId, setTargetHostId] = useState('');
  const [judgeId, setJudgeId] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [remoteGameMode, setRemoteGameMode] = useState<GameMode>('sparring'); // Sync state for judge
  const [hostState, setHostState] = useState<any>(null); // State received from host (for Judge 1)
  
  // Connection Modal Tab State
  const [connectTab, setConnectTab] = useState<'wireless' | 'gamepad'>('wireless');
  const [hostGamepadConnected, setHostGamepadConnected] = useState(false);
  
  // Dashboard Connection State
  const [mainDashboardId, setMainDashboardId] = useState(initialDashboardId);
  const [courtName, setCourtName] = useState(initialCourtName);
  const [isDashboardConnected, setIsDashboardConnected] = useState(false);
  
  // Refs for PeerJS
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<any>(null); // For Judge: connection to host
  const hostConnsRef = useRef<any[]>([]); // For Host: connections from judges
  const peerToJudgeMap = useRef<Map<string, number>>(new Map());

  // Refs for State Access in Callbacks
  const timerRef = useRef<number | null>(null);
  const voteTimeouts = useRef<Record<string, number>>({});
  const timeLeftRef = useRef(timeLeft); // To solve stale closure in logs

  // --- Custom Audio State ---
  const [hasStartCustomSound, setHasStartCustomSound] = useState(false);
  const [hasStopCustomSound, setHasStopCustomSound] = useState(false);
  const startFileInputRef = useRef<HTMLInputElement>(null);
  const stopFileInputRef = useRef<HTMLInputElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const startAudioBufferRef = useRef<AudioBuffer | null>(null);
  const stopAudioBufferRef = useRef<AudioBuffer | null>(null);

  const setShowButtonCheckModal = (val: boolean) => {
      setShowButtonCheckModalState(val);
      showButtonCheckRef.current = val;
      if (!val) setButtonCheckState({});
  };

  // Sync timeLeftRef with timeLeft state
  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  // --- Audio Logic ---
  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtxRef.current;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'start' | 'stop') => {
      const file = e.target.files?.[0];
      if (file) {
          try {
            const arrayBuffer = await file.arrayBuffer();
            const ctx = getAudioContext();
            const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
            
            if (type === 'start') {
                startAudioBufferRef.current = decodedBuffer;
                setHasStartCustomSound(true);
                playBuzzer('start', 0.5);
            } else {
                stopAudioBufferRef.current = decodedBuffer;
                setHasStopCustomSound(true);
                playBuzzer('stop');
            }
            
            alert(`${type === 'start' ? '시작' : '정지'} 부저음이 변경되었습니다.`);
          } catch (err) {
            console.error("Audio decode error:", err);
            alert("오디오 파일을 불러오는데 실패했습니다. (지원되지 않는 형식이거나 손상된 파일)");
          }
      }
  };

  const playBuzzer = (type: 'start' | 'stop', duration = 1.5) => {
    try {
      const ctx = getAudioContext();
      // Try to resume if suspended (important for some browsers)
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const buffer = type === 'start' ? startAudioBufferRef.current : stopAudioBufferRef.current;

      if (buffer) {
          // Play Custom Sound via Web Audio API
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start(0);
          // Note: Custom audio files play for their full length unless stopped manually.
          // Implementing duration cut-off for custom files would require more logic, 
          // but for the default oscillator, it's easy.
      } else {
          // Default Buzzer (Oscillator)
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.connect(gain);
          gain.connect(ctx.destination);

          // Buzzer Tone (Square wave)
          osc.type = 'square';
          
          if (type === 'start') {
              // Higher pitch for start
              osc.frequency.setValueAtTime(880, ctx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1); 
              osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
          } else {
              // Standard pitch for stop
              osc.frequency.setValueAtTime(440, ctx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1); 
              osc.frequency.setValueAtTime(440, ctx.currentTime + 0.1);
          }

          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + (duration * 0.66));
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

          osc.start();
          osc.stop(ctx.currentTime + duration);
      }
    } catch (e) {
      console.error("Audio play failed", e);
    }
  };

  const prevIsRunningRef = useRef(isRunning);
  const prevTimeLeftRef = useRef(timeLeft);
  const prevMatchResultRef = useRef(matchResult);

  // --- Sound Triggers ---
  useEffect(() => {
    // Only Sparring Mode
    if (gameMode !== 'sparring') {
        prevIsRunningRef.current = isRunning;
        prevTimeLeftRef.current = timeLeft;
        prevMatchResultRef.current = matchResult;
        return;
    }

    // Start Trigger -> ADDED per request (Short beep)
    if (!prevIsRunningRef.current && isRunning) {
       playBuzzer('start', 1.0);
    }

    // Pause Trigger (Manual Pause) -> ADDED per request
    // Only trigger if time remains and no result yet (to avoid double buzzer with Time Over/Result)
    if (prevIsRunningRef.current && !isRunning && timeLeft > 0 && !matchResult) {
        playBuzzer('stop');
    }

    // End Trigger (Time Over)
    if (prevTimeLeftRef.current > 0 && timeLeft === 0) {
        playBuzzer('stop');
    }

    // End Trigger (Match Result Decision)
    if (!prevMatchResultRef.current && matchResult) {
        playBuzzer('stop');
    }

    prevIsRunningRef.current = isRunning;
    prevTimeLeftRef.current = timeLeft;
    prevMatchResultRef.current = matchResult;
  }, [isRunning, timeLeft, matchResult, gameMode]);


  // --- Sync Game Mode & State to Judges ---
  const lastBroadcastTime = useRef(0);

  const broadcastState = () => {
      const state = {
          red: redPlayer,
          blue: bluePlayer,
          timeLeft,
          isRunning,
          isResting,
          currentRound,
          matchResult,
          gameMode,
          isScoreRevealed,
          redJudges,
          blueJudges
      };
      
      // Sync to dashboard
      if (dashboardConnRef.current?.open) {
          dashboardConnRef.current.send({ type: 'court_state', state });
      }
  };

  useEffect(() => {
    // Whenever gameMode changes, broadcast to all judges
    hostConnsRef.current.forEach(conn => {
        if (conn.open) {
            conn.send({ type: 'gamemode', mode: gameMode });
        }
    });
  }, [gameMode]);

  // Broadcast state on changes
  useEffect(() => {
      const now = Date.now();
      // Throttle time updates if running
      if (isRunning && now - lastBroadcastTime.current < 900) {
          if (prevIsRunningRef.current === isRunning) return; 
      }
      lastBroadcastTime.current = now;
      broadcastState();
  }, [redPlayer, bluePlayer, isRunning, isResting, currentRound, matchResult, timeLeft, gameMode, isScoreRevealed]);

  // Command Handler Ref (to access fresh state in PeerJS callbacks)
  const handleRemoteCommand = (data: any) => {
      if (data.cmd === 'toggle_timer') {
          handleStartPause();
      }
      if (data.cmd === 'start_timer') {
          if (!isRunning) handleStartPause();
      }
      if (data.cmd === 'stop_timer') {
          if (isRunning) handleStartPause();
      }
      if (data.cmd === 'penalty') {
          if (data.penaltyType === 'kyonggo') handleKyonggo(data.color, data.delta);
          if (data.penaltyType === 'gamjeom') handleGamjeom(data.color, data.delta);
      }
      if (data.cmd === 'adjust_score') {
          adjustScore(data.color, data.points);
      }
      if (data.cmd === 'reveal_score') {
          setIsScoreRevealed(true);
          addLog("호신술 판정 공개 (외부 리모컨)");
      }
      if (data.cmd === 'hide_score') {
          setIsScoreRevealed(false);
          addLog("호신술 판정 숨기기 (외부 리모컨)");
      }
  };
  const commandHandlerRef = useRef(handleRemoteCommand);
  useEffect(() => { commandHandlerRef.current = handleRemoteCommand; });

  // --- PeerJS Initialization ---
  useEffect(() => {
    const peer = new Peer();
    
    peer.on('open', (id) => {
        console.log('My Peer ID is: ' + id);
        setMyPeerId(id);
    });

    peer.on('call', (call) => {
        // Video disabled
        call.answer();
    });

    peer.on('connection', (conn) => {
        if (!conn) return;
        conn.on('open', () => {
            console.log('Connected to: ' + conn.peer);
            hostConnsRef.current.push(conn);
            // Send current game mode immediately on connection
            conn.send({ type: 'gamemode', mode: gameMode });
        });

        conn.on('data', (data: any) => {
            if (data.type === 'register') {
                const jId = data.judgeId;
                peerToJudgeMap.current.set(conn.peer, jId);
                setJudgeConnectionStatus(prev => ({...prev, [jId]: true}));
            }
            
            if (data.type === 'vote') {
                if (showButtonCheckRef.current) {
                    const key = `${data.judgeId}-${data.color}-${data.points}`;
                    setButtonCheckState(prev => ({...prev, [key]: true}));
                    setTimeout(() => {
                        setButtonCheckState(prev => ({...prev, [key]: false}));
                    }, 300);
                    return;
                }
                handleElectronicVote(data.color, data.judgeId, data.points);
            }

            if (data.type === 'command') {
                commandHandlerRef.current(data);
            }
        });
        
        conn.on('close', () => {
            hostConnsRef.current = hostConnsRef.current.filter(c => c !== conn);
            const jId = peerToJudgeMap.current.get(conn.peer);
            if (jId) {
                setJudgeConnectionStatus(prev => ({...prev, [jId]: false}));
                peerToJudgeMap.current.delete(conn.peer);
            }
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
        });
    });

    peerRef.current = peer;
    return () => { peer.destroy(); };
  }, [gameMode]); 

  // --- Connect Logic (Judge) ---
  const connectToHost = () => {
      if (!peerRef.current || !targetHostId || !judgeId) return;
      const conn = peerRef.current.connect(targetHostId);
      if (!conn) {
          alert('연결 생성 실패. (Peer not ready)');
          return;
      }
      conn.on('open', () => {
          setIsConnected(true);
          connRef.current = conn;
          conn.send({ type: 'register', judgeId: judgeId });
      });
      conn.on('data', (data: any) => {
          if (data.type === 'gamemode') {
              setRemoteGameMode(data.mode);
          }
          if (data.type === 'state_update') {
              setHostState(data.state);
          }
      });
      conn.on('close', () => {
          setIsConnected(false);
          alert('호스트와 연결이 끊어졌습니다.');
          connRef.current = null;
      });
      conn.on('error', (err) => {
          alert('연결 실패. ID를 확인하세요.');
      });
  };

  // --- Connect Logic (Dashboard) ---
  const connectToDashboard = () => {
      if (!peerRef.current || !mainDashboardId) return;
      const conn = peerRef.current.connect(mainDashboardId);
      if (!conn) {
          alert('연결 생성 실패. (Peer not ready)');
          return;
      }
      conn.on('open', () => {
          console.log('Connected to Dashboard:', mainDashboardId);
          setIsDashboardConnected(true);
          dashboardConnRef.current = conn;
          conn.send({ type: 'court_register', courtName });
          
          // Send initial state
          conn.send({ type: 'court_state', state: {
              red: redPlayer, blue: bluePlayer, timeLeft, isRunning, isResting, currentRound, matchResult, gameMode,
              isScoreRevealed, redJudges, blueJudges
          }});
      });
      conn.on('close', () => {
          setIsDashboardConnected(false);
          dashboardConnRef.current = null;
          alert('통합관제와 연결이 끊어졌습니다.');
      });
      conn.on('error', (err) => {
          alert('통합관제 연결 실패. 코드를 확인하세요.');
      });
  };

  // Auto-connect to dashboard if ID is provided via URL
  useEffect(() => {
    if (initialDashboardId && peerRef.current && !isDashboardConnected) {
      // Wait a bit for peer to be fully ready
      const timer = setTimeout(() => {
        connectToDashboard();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [initialDashboardId, peerRef.current]);

  useEffect(() => {
    if (viewMode === 'judge' && targetHostId && judgeId && !isConnected && peerRef.current) {
        const timer = setTimeout(() => {
            connectToHost();
        }, 1000);
        return () => clearTimeout(timer);
    }
  }, [viewMode, targetHostId, judgeId, isConnected, peerRef.current]);

  const sendVote = (color: PlayerColor, points: number) => {
      if (!connRef.current || !judgeId) return;
      if (navigator.vibrate) navigator.vibrate(50);
      connRef.current.send({ type: 'vote', color, judgeId, points });
  };


  // --- Game Timer ---
  useEffect(() => {
    // Timer is only active in sparring mode
    if (gameMode === 'sparring' && isRunning && timeLeft > 0 && !matchResult) {
      timerRef.current = window.setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) { setIsRunning(false); return 0; }
          return prev - 1;
        });
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRunning, timeLeft, matchResult, gameMode]);

  // --- Rest Timer ---
  useEffect(() => {
    let interval: number | null = null;
    if (gameMode === 'sparring' && isResting) {
      if (restTimeLeft <= 0) {
          setIsResting(false);
      } else {
          interval = window.setInterval(() => {
            setRestTimeLeft((prev) => {
                if (prev <= 1) return 0;
                return prev - 1;
            });
          }, 100);
      }
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isResting, restTimeLeft, gameMode]);

  // --- Rules Enforcement (Sparring Only) ---
  useEffect(() => {
    if (gameMode === 'hosinsul') return; // No auto-end in Hosinsul
    if (matchResult || isManualOverride) return;

    // Round 3: Golden Point / Sudden Death Rules
    if (currentRound === 3) {
        if (redPlayer.score > bluePlayer.score) {
            setIsRunning(false);
            setMatchResult("홍 승 (선득점)");
            return;
        }
        if (bluePlayer.score > redPlayer.score) {
            setIsRunning(false);
            setMatchResult("청 승 (선득점)");
            return;
        }
        if (redPlayer.kyonggo > bluePlayer.kyonggo) {
            setIsRunning(false);
            setMatchResult("청 승 (홍 경고패)");
            return;
        }
        if (bluePlayer.kyonggo > redPlayer.kyonggo) {
            setIsRunning(false);
            setMatchResult("홍 승 (청 경고패)");
            return;
        }
    }

    const diff = Math.abs(redPlayer.score - bluePlayer.score);
    
    if (timerMode === 'firstToScore') {
      if (redPlayer.score > 0) {
        setIsRunning(false);
        setMatchResult("홍 승 (선득점)");
        return;
      }
      if (bluePlayer.score > 0) {
        setIsRunning(false);
        setMatchResult("청 승 (선득점)");
        return;
      }
    }

    if (diff >= POINT_GAP_LIMIT) {
      setIsRunning(false);
      setMatchResult(redPlayer.score > bluePlayer.score ? "홍 승 (점수차)" : "청 승 (점수차)");
    }
    if (redPlayer.kyonggo >= WARNING_DQ_LIMIT) {
        setRedPlayer(p => ({...p, disqualified: true}));
        setIsRunning(false);
        setMatchResult("청 승 (홍 실격)");
    }
    if (bluePlayer.kyonggo >= WARNING_DQ_LIMIT) {
        setBluePlayer(p => ({...p, disqualified: true}));
        setIsRunning(false);
        setMatchResult("홍 승 (청 실격)");
    }
  }, [redPlayer, bluePlayer, matchResult, gameMode, currentRound]);

  // --- Time Limit Decision (Sparring Only) ---
  useEffect(() => {
      if (gameMode === 'sparring' && timeLeft === 0 && !matchResult) {
          // Auto decision for 2-minute mode, Round 2 or Sudden Death (Round 3)
          if ((roundDuration === 120 && currentRound === 2) || currentRound === 3) {
              determineWinner("경기 종료");
          }
      }
  }, [timeLeft, gameMode, roundDuration, currentRound, matchResult, redPlayer, bluePlayer]);

  // --- Hosinsul Score Calculation ---
  useEffect(() => {
      if (gameMode === 'hosinsul') {
          // Score is simply the count of active judges for each side
          const rScore = redJudges.filter(j => j.active).length;
          const bScore = blueJudges.filter(j => j.active).length;
          setRedPlayer(prev => ({ ...prev, score: rScore }));
          setBluePlayer(prev => ({ ...prev, score: bScore }));
      }
  }, [redJudges, blueJudges, gameMode]);

  // --- Consensus Logic (Sparring Only) ---
  useEffect(() => {
    if (gameMode === 'hosinsul' || matchResult) return;
    
    const checkSide = (color: PlayerColor, judges: JudgeState[]) => {
      for (let p = 1; p <= 2; p++) {
        const matching = judges.filter(j => j.vote === p);
        if (matching.length >= 2) {
          setPendingScore(prev => {
            if (prev && prev.color === color && prev.points === p) {
              if (matching.length > prev.judges.length) {
                return { ...prev, judges: matching.map(j => j.id) };
              }
              return prev;
            }
            if (!prev) return { color, points: p, judges: matching.map(j => j.id) };
            return prev;
          });
          return true;
        }
      }
      return false;
    };

    if (checkSide('red', redJudges)) return;
    if (checkSide('blue', blueJudges)) return;
  }, [redJudges, blueJudges, matchResult, gameMode]);

  useEffect(() => {
    if (pendingScore) {
      const timer = setTimeout(() => {
        updateScore(pendingScore.color, pendingScore.points, true, pendingScore.judges);
        setPendingScore(null);
      }, 200); // 200ms window to capture 3rd judge
      return () => clearTimeout(timer);
    }
  }, [pendingScore]);

  // --- Helper Functions ---
  const determineWinner = (reason: string) => {
      if (redPlayer.score > bluePlayer.score) {
          setMatchResult(`홍 승 (${reason})`);
      } else if (bluePlayer.score > redPlayer.score) {
          setMatchResult(`청 승 (${reason})`);
      } else {
          // Score tie - check Kyonggo ONLY for 2-minute mode
          if (roundDuration === 120) {
              if (redPlayer.kyonggo < bluePlayer.kyonggo) {
                  setMatchResult(`홍 승 (${reason} - 경고 우세)`);
                  setIsRunning(false);
                  return;
              } else if (bluePlayer.kyonggo < redPlayer.kyonggo) {
                  setMatchResult(`청 승 (${reason} - 경고 우세)`);
                  setIsRunning(false);
                  return;
              }
          }
          setMatchResult(`무승부 (${reason})`);
      }
      setIsRunning(false);
  };

  const formatTime = (deciseconds: number) => {
    if (deciseconds < 600) return (deciseconds / 10).toFixed(1);
    const seconds = Math.ceil(deciseconds / 10);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const addLog = (msg: string) => {
    // Use Ref to avoid stale closure issue in callbacks
    const currentTime = timeLeftRef.current;
    setLogs(prev => [{
      id: Date.now() + Math.random(),
      time: gameMode === 'sparring' ? formatTime(currentTime) : '0:00',
      round: currentRound,
      message: msg
    }, ...prev]);
  };

  const triggerSos = (info: string) => {
      // Disabled
  };

  const addButtonLog = (color: PlayerColor, judgeId: number, points: number) => {
    // Use Ref to avoid stale closure issue in callbacks
    const currentTime = timeLeftRef.current;
    const teamName = color === 'red' ? '홍' : '청';
    setButtonLogs(prev => [{
      id: Date.now() + Math.random(),
      time: gameMode === 'sparring' ? formatTime(currentTime) : '0:00',
      message: `${teamName} 부심${judgeId} : +${points} 입력`
    }, ...prev]);
  };

  // --- Round Change Enforcement ---
  useEffect(() => {
      // Clear any pending votes when round changes
      votesRef.current.red = [null, null, null, null, null];
      votesRef.current.blue = [null, null, null, null, null];
      setRedJudges(prev => prev.map(j => ({ ...j, vote: null })));
      setBlueJudges(prev => prev.map(j => ({ ...j, vote: null })));

      if (currentRound === 3) {
          setRoundDuration(60);
          setTimeLeft(600);
          setIsRunning(false);
          addLog("3회전(선득점제) 진입 - 1분/대기 설정");
      }
  }, [currentRound]);

  // --- Update Score ---
  const updateScore = (color: PlayerColor, points: number, isElectronic = false, electronicJudges: number[] = []) => {
    if (matchResult) return;
    // Only used in Sparring
    const teamName = color === 'red' ? '홍' : '청';

    if (!isElectronic) {
        const activeJudges = color === 'red' ? redJudges : blueJudges;
        const participating = activeJudges.filter(j => j.active && j.id <= 3); // Manual sparring only checks 3 judges usually
        if (participating.length < 2) return;

        const setPlayer = color === 'red' ? setRedPlayer : setBluePlayer;
        const resetJudges = color === 'red' 
          ? () => setRedJudges(prev => prev.map(j => ({ ...j, active: false })))
          : () => setBlueJudges(prev => prev.map(j => ({ ...j, active: false })));

        setPlayer(prev => ({ ...prev, score: prev.score + points }));
        resetJudges();
        addLog(`${teamName} 득점 +${points} (부심[${participating.map(j=>j.id).join(',')}] - 수동)`);
    } else {
        const setPlayer = color === 'red' ? setRedPlayer : setBluePlayer;
        const resetVotes = color === 'red'
          ? () => {
              setRedJudges(prev => prev.map(j => ({ ...j, vote: null })));
              votesRef.current.red = [null, null, null, null, null];
            }
          : () => {
              setBlueJudges(prev => prev.map(j => ({ ...j, vote: null })));
              votesRef.current.blue = [null, null, null, null, null];
            };

        setPlayer(prev => ({ ...prev, score: prev.score + points }));
        resetVotes();
        [1,2,3].forEach(id => {
            const key = `${color}-${id}`;
            if (voteTimeouts.current[key]) clearTimeout(voteTimeouts.current[key]);
        });
        addLog(`${teamName} 득점 +${points} (부심[${electronicJudges.join(',')}] - 전자)`);
    }
  };

  const adjustScore = (color: PlayerColor, points: number) => {
    if (matchResult) return;
    const setPlayer = color === 'red' ? setRedPlayer : setBluePlayer;
    setPlayer(prev => ({ ...prev, score: Math.max(0, prev.score + points) }));
    addLog(`${color === 'red' ? '홍' : '청'} 점수 정정 ${points > 0 ? '+' : ''}${points}`);
  };

  const handleManualScore = (color: PlayerColor, points: number) => {
      const setPlayer = color === 'red' ? setRedPlayer : setBluePlayer;
      setPlayer(prev => ({ ...prev, score: Math.max(0, prev.score + points) }));
      addLog(`${color === 'red' ? '홍' : '청'} 득점 ${points > 0 ? '+' : ''}${points} (수동)`);
  };

  const handleElectronicVote = (color: PlayerColor, judgeId: number, points: number, timeoutMs = VOTE_WINDOW_MS) => {
      if (matchResult) return;
      
      // HOSINSUL LOGIC
      if (gameMode === 'hosinsul') {
          // Independent Toggle (No mutual exclusivity, so sum != 5 enforced)
          if (color === 'red') {
              setRedJudges(prev => prev.map(j => j.id === judgeId ? { ...j, active: !j.active } : j));
              // Blue is NOT touched
          } else {
              setBlueJudges(prev => prev.map(j => j.id === judgeId ? { ...j, active: !j.active } : j));
              // Red is NOT touched
          }
          addButtonLog(color, judgeId, 1);
          return;
      }

      // SPARRING LOGIC (Only judges 1-3 valid)
      if (judgeId > 3) return;

      // Conflict detection
      const currentVotes = votesRef.current[color];
      
      // Check if any OTHER judge has a different vote
      const hasConflict = currentVotes.some((v, index) => 
          v !== null && 
          index !== (judgeId - 1) && 
          v !== points
      );
      
      if (hasConflict) {
          setIsRunning(false);
          addLog(`판정 오류: ${color === 'red' ? '홍' : '청'} 부심 투표 불일치`);
          // Do not return, allow the vote to be logged and processed
      }

      addButtonLog(color, judgeId, points);
      const key = `${color}-${judgeId}`;
      if (voteTimeouts.current[key]) clearTimeout(voteTimeouts.current[key]);

      // Update ref
      votesRef.current[color][judgeId - 1] = points;

      const setJudges = color === 'red' ? setRedJudges : setBlueJudges;
      setJudges(prev => prev.map(j => j.id === judgeId ? { ...j, vote: points } : j));

      voteTimeouts.current[key] = window.setTimeout(() => {
          // Update ref
          votesRef.current[color][judgeId - 1] = null;
          setJudges(prev => prev.map(j => j.id === judgeId ? { ...j, vote: null } : j));
      }, timeoutMs);
  };

  // --- Gamepad Handling ---
  useEffect(() => {
      if (viewMode !== 'judge' || !isConnected) return;
      
      let animationFrameId: number;
      const buttonState = {
          lb: false, lt: false, rb: false, rt: false,
          a: false, b: false, x: false, y: false,
          up: false, down: false, logo: false
      };

      const pollGamepads = () => {
          const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
          if (!gamepads) return;

          for (const gp of gamepads) {
              if (!gp) continue;

              // Xbox Share Button (17) for SOS - DISABLED
              if (gp.buttons[17] && gp.buttons[17].pressed && !buttonState.logo) {
                  /*
                  if (connRef.current) {
                      connRef.current.send({ type: 'command', cmd: 'sos', info: `부심 ${judgeId} 긴급 호출!` });
                  } else {
                      // If host is using the gamepad directly
                      triggerSos("본부석 긴급 호출!");
                  }
                  */
                  buttonState.logo = true;
              } else if (gp.buttons[17] && !gp.buttons[17].pressed) buttonState.logo = false;

              // Xbox Logo Button (16) - DISABLED
              if (gp.buttons[16] && gp.buttons[16].pressed && !buttonState.logo) {
                  // Disabled as per user request
                  // buttonState.logo = true;
              } else if (gp.buttons[16] && !gp.buttons[16].pressed) buttonState.logo = false;

              // Standard Mapping (Xbox Controller)
              // 4: LB, 5: RB, 6: LT, 7: RT
              // 0: A, 1: B, 2: X, 3: Y
              // 12: D-pad Up, 13: D-pad Down
              
              // CHIEF REFEREE (Judge 4) CONTROLS
              if (judgeId === 4) {
                  // Helper for sending score commands
                  const sendScore = (color: string, points: number) => {
                      if (connRef.current) {
                          if (navigator.vibrate) navigator.vibrate(50);
                          connRef.current.send({ type: 'command', cmd: 'adjust_score', color, points });
                      }
                  };

                  // Helper for sending penalty commands
                  const sendPenalty = (color: string, pType: string) => {
                      if (connRef.current) {
                          if (navigator.vibrate) navigator.vibrate(50);
                          connRef.current.send({ type: 'command', cmd: 'penalty', color, penaltyType: pType, delta: 1 });
                      }
                  };

                  // Helper for timer commands
                  const sendTimer = (action: 'start' | 'stop') => {
                      if (connRef.current) {
                          if (navigator.vibrate) navigator.vibrate(50);
                          connRef.current.send({ type: 'command', cmd: action === 'start' ? 'start_timer' : 'stop_timer' });
                      }
                  };

                  // D-pad Up (12): Start Timer / Reveal Score
                  if (gp.buttons[12].pressed && !buttonState.up) {
                      if (remoteGameMode === 'hosinsul') {
                          if (connRef.current) {
                              if (navigator.vibrate) navigator.vibrate(50);
                              connRef.current.send({ type: 'command', cmd: 'reveal_score' });
                          }
                      } else {
                          sendTimer('start');
                      }
                      buttonState.up = true;
                  } else if (!gp.buttons[12].pressed) buttonState.up = false;

                  // D-pad Down (13): Stop Timer / Hide Score
                  if (gp.buttons[13].pressed && !buttonState.down) {
                      if (remoteGameMode === 'hosinsul') {
                          if (connRef.current) {
                              if (navigator.vibrate) navigator.vibrate(50);
                              connRef.current.send({ type: 'command', cmd: 'hide_score' });
                          }
                      } else {
                          sendTimer('stop');
                      }
                      buttonState.down = true;
                  } else if (!gp.buttons[13].pressed) buttonState.down = false;

                  // RED (Left Side) - Points
                  if (gp.buttons[4].pressed && !buttonState.lb) { // LB -> Red +1
                      sendScore('red', 1);
                      buttonState.lb = true;
                  } else if (!gp.buttons[4].pressed) buttonState.lb = false;

                  if (gp.buttons[6].pressed && !buttonState.lt) { // LT -> Red +2
                      sendScore('red', 2);
                      buttonState.lt = true;
                  } else if (!gp.buttons[6].pressed) buttonState.lt = false;

                  // BLUE (Right Side) - Points
                  if (gp.buttons[5].pressed && !buttonState.rb) { // RB -> Blue +1
                      sendScore('blue', 1);
                      buttonState.rb = true;
                  } else if (!gp.buttons[5].pressed) buttonState.rb = false;

                  if (gp.buttons[7].pressed && !buttonState.rt) { // RT -> Blue +2
                      sendScore('blue', 2);
                      buttonState.rt = true;
                  } else if (!gp.buttons[7].pressed) buttonState.rt = false;

                  // Button A (0): Red Gamjeom
                  if (gp.buttons[0].pressed && !buttonState.a) {
                      sendPenalty('red', 'gamjeom');
                      buttonState.a = true;
                  } else if (!gp.buttons[0].pressed) buttonState.a = false;

                  // Button X (2): Red Kyonggo
                  if (gp.buttons[2].pressed && !buttonState.x) {
                      sendPenalty('red', 'kyonggo');
                      buttonState.x = true;
                  } else if (!gp.buttons[2].pressed) buttonState.x = false;

                  // Button B (1): Blue Gamjeom
                  if (gp.buttons[1].pressed && !buttonState.b) {
                      sendPenalty('blue', 'gamjeom');
                      buttonState.b = true;
                  } else if (!gp.buttons[1].pressed) buttonState.b = false;

                  // Button Y (3): Blue Kyonggo
                  if (gp.buttons[3].pressed && !buttonState.y) {
                      sendPenalty('blue', 'kyonggo');
                      buttonState.y = true;
                  } else if (!gp.buttons[3].pressed) buttonState.y = false;
              } else {
                  // STANDARD JUDGE CONTROLS (1, 2, 3, 5)
                  // RED (Left Side)
                  if (gp.buttons[4].pressed && !buttonState.lb) { // LB -> Red +2
                      sendVote('red', 2);
                      buttonState.lb = true;
                  } else if (!gp.buttons[4].pressed) buttonState.lb = false;

                  if (gp.buttons[6].pressed && !buttonState.lt) { // LT -> Red +1
                      sendVote('red', 1);
                      buttonState.lt = true;
                  } else if (!gp.buttons[6].pressed) buttonState.lt = false;

                  // BLUE (Right Side)
                  if (gp.buttons[5].pressed && !buttonState.rb) { // RB -> Blue +2
                      sendVote('blue', 2);
                      buttonState.rb = true;
                  } else if (!gp.buttons[5].pressed) buttonState.rb = false;

                  if (gp.buttons[7].pressed && !buttonState.rt) { // RT -> Blue +1
                      sendVote('blue', 1);
                      buttonState.rt = true;
                  } else if (!gp.buttons[7].pressed) buttonState.rt = false;
              }
          }
          animationFrameId = requestAnimationFrame(pollGamepads);
      };

      animationFrameId = requestAnimationFrame(pollGamepads);
      return () => cancelAnimationFrame(animationFrameId);
  }, [viewMode, isConnected, judgeId, remoteGameMode]); // Re-run if judgeId changes (needed for sendVote closure)

  // --- Host Gamepad Handling ---
  const handleHostGamepadRef = useRef((gp: Gamepad, btnState: any) => {});
  const [isMinusMode, setIsMinusMode] = useState(false); // State for Minus Mode
  
  useEffect(() => {
      handleHostGamepadRef.current = (gp: Gamepad, btnState: any) => {
          // Timer (Start/Stop) - D-pad Up/Down
          if (gp.buttons[12].pressed && !btnState.up) {
              if (!isRunning) handleStartPause();
              btnState.up = true;
          } else if (!gp.buttons[12].pressed) btnState.up = false;

          if (gp.buttons[13].pressed && !btnState.down) {
              if (isRunning) handleStartPause();
              btnState.down = true;
          } else if (!gp.buttons[13].pressed) btnState.down = false;

          // Minus Mode ON - D-pad Right (15)
          if (gp.buttons[15].pressed && !btnState.right) {
              setIsMinusMode(true);
              btnState.right = true;
          } else if (!gp.buttons[15].pressed) btnState.right = false;

          // Minus Mode OFF - D-pad Left (14)
          if (gp.buttons[14].pressed && !btnState.left) {
              setIsMinusMode(false);
              btnState.left = true;
          } else if (!gp.buttons[14].pressed) btnState.left = false;

          // Reset Match - Left Stick Click (10)
          if (gp.buttons[10].pressed && !btnState.l3) {
              resetMatch();
              addLog("경기 초기화 (외부 리모컨)");
              btnState.l3 = true;
          } else if (!gp.buttons[10].pressed) btnState.l3 = false;

          // Decision Timer - Left Stick Left
          if (gp.axes[0] < -0.95 && !btnState.lsLeft) {
              if (!matchResult) {
                  startDecisionTimer();
                  addLog("판정 시간 시작 (1분) (외부 리모컨)");
              }
              btnState.lsLeft = true;
          } else if (gp.axes[0] >= -0.95) {
              btnState.lsLeft = false;
          }

          // Reset Timer - Right Stick Click (11)
          if (gp.buttons[11].pressed && !btnState.r3) {
              if (gameMode === 'sparring') {
                  setIsRunning(false);
                  setTimeLeft(roundDuration * 10);
                  addLog("시간 리셋 (외부 리모컨)");
              }
              btnState.r3 = true;
          } else if (!gp.buttons[11].pressed) btnState.r3 = false;

          // Rest Mode - Right Stick Down (Axis 3 > 0.95 for ~100%)
          if (gp.axes[3] > 0.95 && !btnState.rsDown) {
              handleRest();
              btnState.rsDown = true;
          } else if (gp.axes[3] <= 0.95) {
              btnState.rsDown = false;
          }

          // Next Round - Right Stick Right (Axis 2 > 0.95 for ~100%)
          if (gp.axes[2] > 0.95 && !btnState.rsRight) {
              setCurrentRound(prev => (prev % 3) + 1);
              addLog("다음 회전 (외부 리모컨)");
              btnState.rsRight = true;
          } else if (gp.axes[2] <= 0.95) {
              btnState.rsRight = false;
          }

          // Previous Round - Right Stick Left (Axis 2 < -0.95)
          if (gp.axes[2] < -0.95 && !btnState.rsLeft) {
              setCurrentRound(prev => (prev === 1 ? 3 : prev - 1));
              addLog("이전 회전 (외부 리모컨)");
              btnState.rsLeft = true;
          } else if (gp.axes[2] >= -0.95) {
              btnState.rsLeft = false;
          }

          // Toggle Round Duration - Right Stick Up (Axis 3 < -0.95 for ~100%)
          if (gp.axes[3] < -0.95 && !btnState.rsUp) {
              const newDuration = roundDuration === 60 ? 120 : 60;
              setRoundDuration(newDuration);
              if (!isRunning) setTimeLeft(newDuration * 10);
              addLog(`라운드 시간 변경: ${newDuration/60}분 (외부 리모컨)`);
              btnState.rsUp = true;
          } else if (gp.axes[3] >= -0.95) {
              btnState.rsUp = false;
          }

          // Helper for unconditional score update
          const updateScoreRemote = (color: PlayerColor, points: number) => {
              if (matchResult) return;
              const finalPoints = isMinusMode ? -points : points;
              
              const setPlayer = color === 'red' ? setRedPlayer : setBluePlayer;
              setPlayer(prev => ({ ...prev, score: Math.max(0, prev.score + finalPoints) }));
              addLog(`${color === 'red' ? '홍' : '청'} 득점 ${finalPoints > 0 ? '+' : ''}${finalPoints} (외부 리모컨)`);
          };

          // Red Points (LB/LT)
          if (gp.buttons[4].pressed && !btnState.lb) { updateScoreRemote('red', 2); btnState.lb = true; }
          else if (!gp.buttons[4].pressed) btnState.lb = false;

          if (gp.buttons[6].pressed && !btnState.lt) { updateScoreRemote('red', 1); btnState.lt = true; }
          else if (!gp.buttons[6].pressed) btnState.lt = false;

          // Blue Points (RB/RT)
          if (gp.buttons[5].pressed && !btnState.rb) { updateScoreRemote('blue', 2); btnState.rb = true; }
          else if (!gp.buttons[5].pressed) btnState.rb = false;

          if (gp.buttons[7].pressed && !btnState.rt) { updateScoreRemote('blue', 1); btnState.rt = true; }
          else if (!gp.buttons[7].pressed) btnState.rt = false;

          // Penalties
          // Red Gamjeom (A)
          if (gp.buttons[0].pressed && !btnState.a) { handleGamjeom('red', isMinusMode ? -1 : 1); btnState.a = true; }
          else if (!gp.buttons[0].pressed) btnState.a = false;
          
          // Red Kyonggo (X)
          if (gp.buttons[2].pressed && !btnState.x) { handleKyonggo('red', isMinusMode ? -1 : 1); btnState.x = true; }
          else if (!gp.buttons[2].pressed) btnState.x = false;

          // Blue Gamjeom (B)
          if (gp.buttons[1].pressed && !btnState.b) { handleGamjeom('blue', isMinusMode ? -1 : 1); btnState.b = true; }
          else if (!gp.buttons[1].pressed) btnState.b = false;

          // Blue Kyonggo (Y)
          if (gp.buttons[3].pressed && !btnState.y) { handleKyonggo('blue', isMinusMode ? -1 : 1); btnState.y = true; }
          else if (!gp.buttons[3].pressed) btnState.y = false;

          // SOS Alert - DISABLED
          if (gp.buttons[17] && gp.buttons[17].pressed && !btnState.capture) {
              // triggerSos("본부석 긴급 호출! (외부 리모컨)");
              btnState.capture = true;
          } else if (gp.buttons[17] && !gp.buttons[17].pressed) btnState.capture = false;

          // SOS Alert - Connect/Logo Button (16) - DISABLED
          if (gp.buttons[16] && gp.buttons[16].pressed && !btnState.logo) {
              // triggerSos("본부석 긴급 호출! (외부 리모컨)");
              btnState.logo = true;
          } else if (gp.buttons[16] && !gp.buttons[16].pressed) btnState.logo = false;
      };
  });

  useEffect(() => {
      if (viewMode !== 'host') return;
      
      let animationFrameId: number;
      const buttonState = {
          lb: false, lt: false, rb: false, rt: false,
          a: false, b: false, x: false, y: false,
          up: false, down: false, right: false, left: false,
          l3: false, r3: false, rsDown: false, rsRight: false, rsUp: false,
          lsLeft: false, lsRight: false, start: false, logo: false,
          capture: false
      };

      const pollHostGamepad = () => {
          const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
          const gp = gamepads[0]; // Assume first controller
          
          if (gp) {
              setHostGamepadConnected(true);
              handleHostGamepadRef.current(gp, buttonState);
          } else {
              setHostGamepadConnected(false);
          }
          animationFrameId = requestAnimationFrame(pollHostGamepad);
      };

      animationFrameId = requestAnimationFrame(pollHostGamepad);
      return () => cancelAnimationFrame(animationFrameId);
  }, [viewMode]);

  // --- Keyboard Handling ---
  useEffect(() => {
      if (viewMode === 'judge') return;
      const handleKeyDown = (e: KeyboardEvent) => {
          const key = e.key.toUpperCase();
          
          // Common Controls
          if (key === ' ') { handleStartPause(); return; }
          if (key === 'Z') { handleRest(); return; }
          if (key === 'X') { startDecisionTimer(); return; }
          if (key === 'N') { /* triggerSos("긴급 상황 발생!"); */ return; }
          if (key === '6') { resetMatch(); return; }
          if (key === '7') { setTimeLeft(roundDuration * 10); return; }
          if (key === '1') { setCurrentRound(1); return; }
          if (key === '2') { setCurrentRound(2); return; }
          if (key === '3') { setCurrentRound(3); return; }
          if (key === '+' || key === '=') { setRoundDuration(120); setTimeLeft(1200); return; }
          if (key === '-') { setRoundDuration(60); setTimeLeft(600); return; }

          if (gameMode === 'sparring') {
              const handleKeyboardVote = (color: PlayerColor, judgeId: number, points: number) => {
                  handleElectronicVote(color, judgeId, points);
              };

              // Sparring Mappings
              // Red 2pt: W, E, R (Judge 1, 2, 3)
              // Red 1pt: S, D, F (Judge 1, 2, 3)
              if (key === 'W') handleKeyboardVote('red', 1, 2);
              if (key === 'E') handleKeyboardVote('red', 2, 2);
              if (key === 'S') handleKeyboardVote('red', 1, 1);
              if (key === 'D') handleKeyboardVote('red', 2, 1);
              if (key === 'F') handleKeyboardVote('red', 3, 1);

              // Blue 2pt: U, I, O (Judge 1, 2, 3)
              // Blue 1pt: J, K, L (Judge 1, 2, 3)
              if (key === 'U') handleKeyboardVote('blue', 1, 2);
              if (key === 'I') handleKeyboardVote('blue', 2, 2);
              if (key === 'O') handleKeyboardVote('blue', 3, 2);
              if (key === 'J') handleKeyboardVote('blue', 1, 1);
              if (key === 'K') handleKeyboardVote('blue', 2, 1);
              if (key === 'L') handleKeyboardVote('blue', 3, 1);

              // Penalties
              // R is used for Red 2pt (Judge 3), but user said "R 홍경고".
              // I'll prioritize the 2pt mapping for W,E,R sequence, but user request is explicit.
              // Wait, I'll use 'T' for Red Warning if R is used for 2pt? 
              // Actually, I'll follow the user's explicit penalty mapping:
              // R: 홍경고, G: 홍감점, Y: 청경고, H: 청감점
              // If R is used for both, I'll use 'T' for Red 2pt (Judge 3) instead to avoid conflict.
              if (key === 'T') handleKeyboardVote('red', 3, 2); // Re-mapped Judge 3 2pt to T
              if (key === 'R') handleKyonggo('red', 1);
              if (key === 'G') handleGamjeom('red', 1);
              if (key === 'Y') handleKyonggo('blue', 1);
              if (key === 'H') handleGamjeom('blue', 1);
          } else {
              // Hosinsul Mappings (Q-T for Red, Y-P for Blue)
              if (key === 'Q') handleElectronicVote('red', 1, 1);
              if (key === 'W') handleElectronicVote('red', 2, 1);
              if (key === 'E') handleElectronicVote('red', 3, 1);
              if (key === 'R') handleElectronicVote('red', 4, 1);
              if (key === 'T') handleElectronicVote('red', 5, 1);

              if (key === 'Y') handleElectronicVote('blue', 1, 1);
              if (key === 'U') handleElectronicVote('blue', 2, 1);
              if (key === 'I') handleElectronicVote('blue', 3, 1);
              if (key === 'O') handleElectronicVote('blue', 4, 1);
              if (key === 'P') handleElectronicVote('blue', 5, 1);
          }

      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [matchResult, viewMode, gameMode, isRunning, isManualOverride, roundDuration]);

  // --- Penalty Handling (Sparring Only) ---
  const handleKyonggo = (color: PlayerColor, delta: number) => {
    if (matchResult || gameMode === 'hosinsul') return;
    const isRed = color === 'red';
    const player = isRed ? redPlayer : bluePlayer;
    const setPlayer = isRed ? setRedPlayer : setBluePlayer;
    if (delta > 0) {
        const newCount = player.kyonggo + 1;
        setPlayer(prev => ({...prev, kyonggo: newCount}));
        addLog(`${isRed?'홍':'청'} 경고 (${newCount}회)`);
        if (newCount % 2 === 0) handleGamjeom(color, 1, true);
    } else {
        if (player.kyonggo <= 0) return;
        const currentCount = player.kyonggo;
        if (currentCount % 2 === 0) handleGamjeom(color, -1, true);
        setPlayer(prev => ({...prev, kyonggo: currentCount - 1}));
        addLog(`${isRed?'홍':'청'} 경고 취소`);
    }
  };

  const handleGamjeom = (color: PlayerColor, delta: number, automated = false) => {
    if (matchResult || gameMode === 'hosinsul') return;
    const isRed = color === 'red';
    const player = isRed ? redPlayer : bluePlayer;
    const setPlayer = isRed ? setRedPlayer : setBluePlayer;
    const setOpponent = isRed ? setBluePlayer : setRedPlayer;

    if (delta > 0) {
        setOpponent(prev => ({...prev, score: prev.score + 1}));
        if (!automated) {
            setPlayer(prev => ({...prev, gamjeom: prev.gamjeom + 1, kyonggo: prev.kyonggo + 2 }));
            addLog(`${isRed?'홍':'청'} 감점 (+1 상대 점수, 경고 +2)`);
        } else {
            setPlayer(prev => ({...prev, gamjeom: prev.gamjeom + 1}));
            addLog(`${isRed?'홍':'청'} 감점 (+1 상대 점수) [경고누적]`);
        }
    } else {
        if (player.gamjeom <= 0) return;
        setOpponent(prev => ({...prev, score: Math.max(0, prev.score - 1)}));
        if (!automated) {
            setPlayer(prev => ({...prev, gamjeom: prev.gamjeom - 1, kyonggo: Math.max(0, prev.kyonggo - 2) }));
            addLog(`${isRed?'홍':'청'} 감점 취소 (-1 상대 점수, 경고 -2)`);
        } else {
            setPlayer(prev => ({...prev, gamjeom: prev.gamjeom - 1}));
            addLog(`${isRed?'홍':'청'} 감점 취소 (-1 상대 점수) [경고취소]`);
        }
    }
  };

  // --- Controls ---
  const resetMatch = () => {
      // Ensure audio context is ready on user interaction
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') ctx.resume();

      setIsRunning(false); setIsResting(false);
      setTimeLeft(roundDuration * 10); setRestTimeLeft(300);
      setCurrentRound(1); setMatchResult(null); setIsManualOverride(false);
      setIsScoreRevealed(false);
      
      const resetStats = { score: 0, gamjeom: 0, kyonggo: 0, disqualified: false };
      setRedPlayer(p => ({...p, ...resetStats})); setBluePlayer(p => ({...p, ...resetStats}));
      setRedJudges(p => p.map(j => ({...j, active: false, vote: null})));
      setBlueJudges(p => p.map(j => ({...j, active: false, vote: null})));
      setLogs([]); setButtonLogs([]);
  };

  const handleStartPause = () => { 
      // Ensure audio context is ready on user interaction
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') ctx.resume();

      if (isResting) setIsResting(false); 
      setIsRunning(!isRunning); 
  };
  const handleRest = () => { setIsRunning(false); setIsResting(true); setTimerMode('rest'); setRestTimeLeft(300); };
  const startDecisionTimer = () => { setIsRunning(false); setIsResting(true); setTimerMode('decision'); setRestTimeLeft(600); };
  
  const toggleJudge = (color: PlayerColor, id: number) => {
    if (gameMode === 'hosinsul') {
        // Exclusivity Logic for Hosinsul
        if (color === 'red') {
             setRedJudges(p => p.map(j => j.id === id ? { ...j, active: !j.active } : j));
             setBlueJudges(p => p.map(j => j.id === id ? { ...j, active: false } : j)); // Unset blue
        } else {
             setBlueJudges(p => p.map(j => j.id === id ? { ...j, active: !j.active } : j));
             setRedJudges(p => p.map(j => j.id === id ? { ...j, active: false } : j)); // Unset red
        }
    } else {
        // Standard Sparring toggle (manual consensus)
        const setJudges = color === 'red' ? setRedJudges : setBlueJudges;
        setJudges(p => p.map(j => j.id === id ? { ...j, active: !j.active } : j));
    }
  };

  const getDisplayResult = () => {
    if (matchResult) return matchResult;
    
    // Hosinsul Logic
    if (gameMode === 'hosinsul' && isScoreRevealed) {
        if (redPlayer.score > bluePlayer.score) return "홍 승";
        if (bluePlayer.score > redPlayer.score) return "청 승";
        return "무승부";
    }
    
    // Sparring Logic - Time Over
    if (gameMode === 'sparring' && timeLeft === 0) {
        // 1-Minute Mode, Round 1: Hide result ONLY if it's a draw
        if (currentRound === 1 && roundDuration === 60 && redPlayer.score === bluePlayer.score) {
            return null;
        }

        if (redPlayer.score > bluePlayer.score) return "홍 승";
        if (bluePlayer.score > redPlayer.score) return "청 승";

        // Tie-breaker for 2-Minute Mode: Fewer Warnings Wins
        if (roundDuration === 120) {
            if (redPlayer.kyonggo < bluePlayer.kyonggo) return "홍 승 (경고 우세)";
            if (bluePlayer.kyonggo < redPlayer.kyonggo) return "청 승 (경고 우세)";
        }

        return "무승부";
    }

    return null;
  };

  const finalResultText = getDisplayResult();

  // --- Render Functions ---
  const renderCircles = (count: number, color: string) => (
    <div style={{
        width: '40px', height: '40px', borderRadius: '50%', background: color,
        border: '3px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.5rem', fontWeight: 'bold', color: color === '#FFD700' ? 'black' : 'white',
        boxShadow: '0 2px 5px rgba(0,0,0,0.5)'
    }}>{count}</div>
  );

  const getJudgeBtnStyle = (judge: JudgeState, color: PlayerColor) => {
      const baseColor = color === 'red' ? '#200' : '#001';
      const activeColor = color === 'red' ? '#ff0000' : '#0047BB';
      const voteColor = '#FFD700';
      
      let background = baseColor;
      let border = `1px solid ${color === 'red' ? '#500' : '#005'}`;
      let text = `부심${judge.id}`;
      let textColor = '#fff';

      // Hosinsul mode: Active means "Voted for this color"
      // Sparring mode: Active means "Manual Selection"
      if (judge.vote !== null) {
          // Momentary electronic vote visual
          background = voteColor; textColor = '#000'; text = `+${judge.vote}`; border = '2px solid #fff';
      } else if (judge.active) {
          background = activeColor; border = '2px solid #fff';
      }
      return { style: { ...styles.judgeBtn, background, border, color: textColor }, text };
  };
  
  // Helper to check voting status for Hosinsul
  const getJudgeVotingStatus = (id: number) => {
      const voted = redJudges.find(j => j.id === id)?.active || blueJudges.find(j => j.id === id)?.active;
      return voted;
  };

  const sendRemoteCommand = (cmd: string, payload: any = {}) => {
      if (!connRef.current) return;
      if (navigator.vibrate) navigator.vibrate(50);
      connRef.current.send({ type: 'command', cmd, ...payload });
  };

  // --- VIEW: Judge Remote ---
  if (viewMode === 'judge') {
      return (
          <div style={{...styles.appContainer, padding:'20px', alignItems:'center'}}>
              <h2 style={{color:'white'}}>부심 리모컨 (Wireless Judge)</h2>
              
              {!isConnected ? (
                  <div style={{display:'flex', flexDirection:'column', gap:'15px', width:'100%', maxWidth:'400px'}}>
                      <input 
                        placeholder="호스트 ID 입력 (Host ID)"
                        value={targetHostId || ''}
                        onChange={e => setTargetHostId(e.target.value)}
                        style={styles.modalInput}
                      />
                      <div style={{display:'flex', gap:'10px', flexWrap:'wrap', justifyContent:'center'}}>
                          {[1, 2, 3, 4, 5].map(id => (
                              <button 
                                key={id}
                                onClick={() => setJudgeId(id)}
                                style={{
                                    ...styles.subActionBtn, 
                                    background: judgeId === id ? '#FFD700' : '#333',
                                    color: judgeId === id ? '#000' : '#fff',
                                    flex: '0 0 18%'
                                }}
                              >
                                  부심 {id}
                              </button>
                          ))}
                      </div>
                      <button 
                        onClick={connectToHost}
                        disabled={!targetHostId || !judgeId}
                        style={{...styles.mainActionBtn, opacity: (!targetHostId || !judgeId) ? 0.5 : 1}}
                      >
                          연결하기
                      </button>
                      <button onClick={() => setViewMode('host')} style={styles.subActionBtn}>
                          메인 화면으로 돌아가기
                      </button>
                  </div>
              ) : (
                  judgeId === 4 ? (
                    // --- CHIEF REFEREE INTERFACE (Judge 4) ---
                    <div style={{display:'flex', flexDirection:'column', width:'100%', height:'100%', gap:'10px'}}>
                        {/* Header with Timer */}
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', background:'#222', padding:'10px', borderRadius:'8px'}}>
                            <div style={{color:'#FFD700', fontWeight:'bold'}}>주심 (Chief Referee)</div>
                            <div style={{fontSize:'2rem', fontWeight:'bold', color: hostState?.isRunning ? '#0f0' : '#fff', fontFamily:'monospace'}}>
                                {hostState ? formatTime(hostState.timeLeft) : '0:00'}
                            </div>
                            <button 
                                onClick={() => sendRemoteCommand('toggle_timer')}
                                style={{padding:'10px 20px', background: hostState?.isRunning ? '#555' : '#0a0', color:'white', 
                                  borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
                                  borderRadius:'5px', fontSize:'1.2rem', fontWeight:'bold'}}
                            >
                                {hostState?.isRunning ? '일시정지' : '시작'}
                            </button>
                        </div>

                        {/* Scores & Penalties */}
                        <div style={{flex:1, display:'flex', gap:'10px'}}>
                            {/* RED */}
                            <div style={{flex:1, background:'#200', borderRadius:'8px', padding:'10px', display:'flex', flexDirection:'column', alignItems:'center'}}>
                                <div style={{fontSize:'1.5rem', color:'#f88'}}>RED</div>
                                <div style={{fontSize:'4rem', fontWeight:'bold', color:'white', fontFamily:'Oswald'}}>{hostState?.red.score || 0}</div>
                                
                                {/* Penalties */}
                                <div style={{display:'flex', flexDirection:'column', gap:'10px', width:'100%', marginTop:'10px'}}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', background:'#400', padding:'5px', borderRadius:'5px'}}>
                                        <span style={{fontSize:'0.9rem'}}>경고 ({hostState?.red.kyonggo || 0})</span>
                                        <div style={{display:'flex', gap:'5px'}}>
                                            <button onClick={() => sendRemoteCommand('penalty', {color:'red', penaltyType:'kyonggo', delta:-1})} style={{...styles.miniBtn, width:'40px', height:'40px', fontSize:'1.2rem'}}>-</button>
                                            <button onClick={() => sendRemoteCommand('penalty', {color:'red', penaltyType:'kyonggo', delta:1})} style={{...styles.miniBtn, width:'40px', height:'40px', fontSize:'1.2rem'}}>+</button>
                                        </div>
                                    </div>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', background:'#400', padding:'5px', borderRadius:'5px'}}>
                                        <span style={{fontSize:'0.9rem'}}>감점 ({hostState?.red.gamjeom || 0})</span>
                                        <div style={{display:'flex', gap:'5px'}}>
                                            <button onClick={() => sendRemoteCommand('penalty', {color:'red', penaltyType:'gamjeom', delta:-1})} style={{...styles.miniBtn, width:'40px', height:'40px', fontSize:'1.2rem'}}>-</button>
                                            <button onClick={() => sendRemoteCommand('penalty', {color:'red', penaltyType:'gamjeom', delta:1})} style={{...styles.miniBtn, width:'40px', height:'40px', fontSize:'1.2rem'}}>+</button>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Voting Buttons */}
                                <div style={{marginTop:'auto', width:'100%', display:'flex', gap:'5px'}}>
                                     <button onPointerDown={(e) => { e.preventDefault(); sendVote('red', 1); }} style={{...styles.remoteBtn, background:'#900', fontSize:'1.5rem', border:'1px solid #f55'}}>+1</button>
                                     <button onPointerDown={(e) => { e.preventDefault(); sendVote('red', 2); }} style={{...styles.remoteBtn, background:'#500', fontSize:'1.5rem', border:'1px solid #f55'}}>+2</button>
                                </div>
                            </div>

                            {/* BLUE */}
                            <div style={{flex:1, background:'#001', borderRadius:'8px', padding:'10px', display:'flex', flexDirection:'column', alignItems:'center'}}>
                                <div style={{fontSize:'1.5rem', color:'#88f'}}>BLUE</div>
                                <div style={{fontSize:'4rem', fontWeight:'bold', color:'white', fontFamily:'Oswald'}}>{hostState?.blue.score || 0}</div>
                                
                                {/* Penalties */}
                                <div style={{display:'flex', flexDirection:'column', gap:'10px', width:'100%', marginTop:'10px'}}>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', background:'#003', padding:'5px', borderRadius:'5px'}}>
                                        <span style={{fontSize:'0.9rem'}}>경고 ({hostState?.blue.kyonggo || 0})</span>
                                        <div style={{display:'flex', gap:'5px'}}>
                                            <button onClick={() => sendRemoteCommand('penalty', {color:'blue', penaltyType:'kyonggo', delta:-1})} style={{...styles.miniBtn, width:'40px', height:'40px', fontSize:'1.2rem'}}>-</button>
                                            <button onClick={() => sendRemoteCommand('penalty', {color:'blue', penaltyType:'kyonggo', delta:1})} style={{...styles.miniBtn, width:'40px', height:'40px', fontSize:'1.2rem'}}>+</button>
                                        </div>
                                    </div>
                                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', background:'#003', padding:'5px', borderRadius:'5px'}}>
                                        <span style={{fontSize:'0.9rem'}}>감점 ({hostState?.blue.gamjeom || 0})</span>
                                        <div style={{display:'flex', gap:'5px'}}>
                                            <button onClick={() => sendRemoteCommand('penalty', {color:'blue', penaltyType:'gamjeom', delta:-1})} style={{...styles.miniBtn, width:'40px', height:'40px', fontSize:'1.2rem'}}>-</button>
                                            <button onClick={() => sendRemoteCommand('penalty', {color:'blue', penaltyType:'gamjeom', delta:1})} style={{...styles.miniBtn, width:'40px', height:'40px', fontSize:'1.2rem'}}>+</button>
                                        </div>
                                    </div>
                                </div>

                                {/* Voting Buttons */}
                                <div style={{marginTop:'auto', width:'100%', display:'flex', gap:'5px'}}>
                                     <button onPointerDown={(e) => { e.preventDefault(); sendVote('blue', 1); }} style={{...styles.remoteBtn, background:'#003366', fontSize:'1.5rem', border:'1px solid #55f'}}>+1</button>
                                     <button onPointerDown={(e) => { e.preventDefault(); sendVote('blue', 2); }} style={{...styles.remoteBtn, background:'#001133', fontSize:'1.5rem', border:'1px solid #55f'}}>+2</button>
                                </div>
                            </div>
                        </div>
                        <button onClick={() => { connRef.current?.close(); setIsConnected(false); }} style={styles.subActionBtn}>
                           연결 종료
                        </button>
                    </div>
                  ) : (
                    // --- STANDARD JUDGE INTERFACE ---
                    <div style={{display:'flex', flexDirection:'column', width:'100%', height:'100%', gap:'10px'}}>
                       <div style={{textAlign:'center', color:'#FFD700', marginBottom:'10px'}}>
                           연결됨: 부심 {judgeId} ({remoteGameMode === 'hosinsul' ? '호신술' : '대련'})
                       </div>
                       
                       <div style={{flex:1, display:'flex', gap:'10px'}}>
                           {/* RED Controls */}
                           <div style={{flex:1, display:'flex', flexDirection:'column', gap:'10px'}}>
                               <button 
                                 onPointerDown={(e) => { e.preventDefault(); sendVote('red', 1); }}
                                 style={{...styles.remoteBtn, background:'#900', border:'2px solid #f00'}}
                               >
                                   홍 (RED)
                                   {remoteGameMode === 'sparring' && <span style={{fontSize:'1rem', display:'block'}}>+1점</span>}
                               </button>
                               {remoteGameMode === 'sparring' && (
                                   <button 
                                     onPointerDown={(e) => { e.preventDefault(); sendVote('red', 2); }}
                                     style={{...styles.remoteBtn, background:'#500', border:'2px solid #f00'}}
                                   >
                                       홍 (RED)
                                       <span style={{fontSize:'1rem', display:'block'}}>+2점</span>
                                   </button>
                               )}
                           </div>
                           
                           {/* BLUE Controls */}
                           <div style={{flex:1, display:'flex', flexDirection:'column', gap:'10px'}}>
                                <button 
                                 onPointerDown={(e) => { e.preventDefault(); sendVote('blue', 1); }}
                                 style={{...styles.remoteBtn, background:'#003366', border:'2px solid #00f'}}
                               >
                                   청 (BLUE)
                                   {remoteGameMode === 'sparring' && <span style={{fontSize:'1rem', display:'block'}}>+1점</span>}
                               </button>
                               {remoteGameMode === 'sparring' && (
                                   <button 
                                     onPointerDown={(e) => { e.preventDefault(); sendVote('blue', 2); }}
                                     style={{...styles.remoteBtn, background:'#001133', border:'2px solid #00f'}}
                                   >
                                       청 (BLUE)
                                       <span style={{fontSize:'1rem', display:'block'}}>+2점</span>
                                   </button>
                               )}
                           </div>
                       </div>
                       <button onClick={() => { connRef.current?.close(); setIsConnected(false); }} style={styles.subActionBtn}>
                           연결 종료
                       </button>
                   </div>
                  )
              )}
          </div>
      );
  }

  // --- VIEW: Host (Scoreboard) ---
  return (
    <div style={styles.appContainer}>
      <style>{`
        @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }
        @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
      `}</style>
      
      {/* Wireless Connect Modal */}
      {showConnectModal && (
          <div style={styles.modalOverlay}>
              <div style={styles.modalContent}>
                  <div style={styles.modalHeader}>
                    <h3 style={{margin:0, color:'#FFD700'}}>무선 연결 (Wireless Connect)</h3>
                    <button onClick={() => setShowConnectModal(false)} style={styles.closeBtn}>X</button>
                  </div>
                  
                  {/* TABS */}
                  <div style={{display:'flex', marginBottom:'20px', borderBottom:'1px solid #444'}}>
                      <button 
                        onClick={() => setConnectTab('wireless')}
                        style={{
                            flex:1, padding:'10px', background:'transparent', 
                            borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                            color: connectTab === 'wireless' ? '#FFD700' : '#888',
                            borderBottom: connectTab === 'wireless' ? '2px solid #FFD700' : 'none',
                            fontWeight:'bold', cursor:'pointer'
                        }}
                      >
                          무선 연결 (Wireless)
                      </button>
                      <button 
                        onClick={() => setConnectTab('gamepad')}
                        style={{
                            flex:1, padding:'10px', background:'transparent', 
                            borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                            color: connectTab === 'gamepad' ? '#FFD700' : '#888',
                            borderBottom: connectTab === 'gamepad' ? '2px solid #FFD700' : 'none',
                            fontWeight:'bold', cursor:'pointer'
                        }}
                      >
                          외부 리모컨 (External Remote)
                      </button>
                  </div>

                  {connectTab === 'wireless' ? (
                      <>
                  <div style={{background:'#fff3cd', color:'#856404', padding:'12px', borderRadius:'8px', marginBottom:'15px', border:'2px solid #dc3545', fontSize:'0.95rem', textAlign:'left', fontWeight:'bold'}}>
                    <b>🚨 필독: 부심 로그인 창 해결 방법</b><br/>
                    부심 스마트폰으로 QR 스캔 시 <b>AI Studio 로그인</b>이 뜨면 안 됩니다!<br/>
                    반드시 현재 화면 우측 상단의 <span style={{color:'#dc3545', textDecoration:'underline'}}>['새 창에서 열기' (Open in new tab)]</span> 아이콘을 클릭하여 페이지를 새로 연 후, 다시 QR을 생성하여 스캔해 주세요.
                  </div>
                  
                  <div style={{background:'#000', padding:'15px', fontSize:'1.5rem', fontWeight:'bold', textAlign:'center', color:'#FFD700', userSelect:'all', border:'1px solid #444', marginBottom:'15px'}}>
                      {myPeerId || "ID 생성 중..."}
                  </div>

                  {/* QR codes for each judge to connect automatically */}
                  <div style={{marginTop:'15px', padding:'15px', background:'#222', borderRadius:'10px', border:'1px solid #FFD700', marginBottom:'15px'}}>
                      <h4 style={{margin:'0 0 10px 0', color:'#FFD700', textAlign:'center', fontSize: '1.1rem'}}>📱 부심 리모컨 QR 코드 연결 (QR Quick Connect)</h4>
                      <p style={{color:'#ccc', fontSize:'0.85rem', textAlign:'center', margin:'0 0 15px 0'}}>
                          부심 기기(스마트폰/태블릿)로 아래 해당 QR 코드를 스캔하면<br/>
                          <b>자동으로 연결 및 부심 권한이 활성화</b>됩니다.
                      </p>
                      
                      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:'12px', justifyContent:'center'}}>
                        {[1, 2, 3, 4, 5].map(id => {
                            const qrUrl = `${window.location.origin}/scoreboard?v=judge&h=${myPeerId}&j=${id}`;
                            return (
                                <div key={id} style={{
                                    background: '#111', padding: '15px 5px', borderRadius: '8px', 
                                    border: judgeConnectionStatus[id] ? '2px solid #0f0' : '1px solid #444', 
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px'
                                }}>
                                    <div style={{fontSize: '0.9rem', fontWeight: 'bold', color: judgeConnectionStatus[id] ? '#0f0' : '#fff'}}>
                                        부심 {id} {id === 4 ? '(주심)' : ''}
                                    </div>
                                    {myPeerId ? (
                                        <div style={{background:'#fff', padding:'5px', borderRadius:'5px', display:'flex', justifyContent:'center', alignItems:'center', width:'110px', height:'110px'}}>
                                              <QRCode 
                                                value={qrUrl} 
                                                size={100}
                                              />
                                        </div>
                                    ) : (
                                        <div style={{color: '#888', fontSize: '0.75rem', height: '110px', display:'flex', alignItems:'center'}}>생성 중...</div>
                                    )}
                                    <div style={{fontSize: '0.75rem', color: judgeConnectionStatus[id] ? '#0f0' : '#888'}}>
                                        {judgeConnectionStatus[id] ? '● 연결됨' : '○ 미연결'}
                                    </div>
                                </div>
                            );
                        })}
                      </div>
                  </div>

                  {/* Connection Status in Modal */}
                  <div style={{marginTop:'15px', padding:'10px', background:'#333', borderRadius:'5px'}}>
                      <div style={{fontSize:'0.9rem', color:'#ccc', marginBottom:'5px', textAlign:'center'}}>현재 연결 상태</div>
                      <div style={{display:'flex', justifyContent:'center', gap:'15px', flexWrap:'wrap'}}>
                        {[1, 2, 3, 4, 5].map(id => (
                            <div key={id} style={{display:'flex', alignItems:'center', gap:'5px', color: judgeConnectionStatus[id] ? '#0f0' : '#888'}}>
                                <div style={{width:'10px', height:'10px', borderRadius:'50%', background: judgeConnectionStatus[id] ? '#0f0' : '#888'}}></div>
                                부심 {id}
                            </div>
                        ))}
                      </div>
                      {/* Xbox Controller Status */}
                      <div style={{display:'flex', justifyContent:'center', marginTop:'10px', borderTop:'1px solid #444', paddingTop:'10px'}}>
                          <div style={{display:'flex', alignItems:'center', gap:'5px', color: hostGamepadConnected ? '#0f0' : '#888'}}>
                              <span style={{fontSize:'1.2rem'}}>🎮</span>
                              외부 리모컨 {hostGamepadConnected ? '(연결됨)' : '(미연결)'}
                          </div>
                      </div>
                  </div>

                  <div style={{marginTop:'20px', textAlign:'center'}}>
                      <p style={{marginBottom:'10px'}}>혹은 이 기기를 부심 리모컨으로 사용하시겠습니까?</p>
                      <button onClick={() => { setViewMode('judge'); setShowConnectModal(false); }} style={styles.mainActionBtn}>
                          부심 리모컨 모드로 전환
                      </button>
                  </div>
                      </>
                  ) : (
                      <div style={{textAlign:'center', padding:'20px'}}>
                          <div style={{fontSize:'4rem', marginBottom:'10px'}}>🎮</div>
                          <h3 style={{color: hostGamepadConnected ? '#0f0' : '#888'}}>
                              {hostGamepadConnected ? "컨트롤러 연결됨 (Connected)" : "컨트롤러 연결 대기중..."}
                          </h3>
                          <p style={{color:'#aaa', marginBottom:'20px'}}>
                              Xbox 컨트롤러 또는 호환 게임패드를 PC에 연결하세요.<br/>
                              (아무 버튼이나 누르면 인식됩니다)
                          </p>
                          
                          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', textAlign:'left', background:'#333', padding:'15px', borderRadius:'8px', fontSize:'0.9rem'}}>
                              <div style={{color:'#f88'}}>🟥 홍 점수 (+1/+2)</div>
                              <div style={{color:'#fff'}}>LB / LT</div>
                              
                              <div style={{color:'#88f'}}>🟦 청 점수 (+1/+2)</div>
                              <div style={{color:'#fff'}}>RB / RT</div>
                              
                              <div style={{color:'#0f0'}}>⏱ 시간 시작/정지</div>
                              <div style={{color:'#fff'}}>D-pad 상/하</div>
                              
                              <div style={{color:'#f88'}}>🟥 경고/감점</div>
                              <div style={{color:'#fff'}}>X / A</div>
                              
                              <div style={{color:'#88f'}}>🟦 경고/감점</div>
                              <div style={{color:'#fff'}}>Y / B</div>

                              <div style={{color:'#FFD700'}}>➖ 마이너스 모드</div>
                              <div style={{color:'#fff'}}>D-pad 우 (ON) / 좌 (OFF)</div>

                              <div style={{color:'#f88'}}>🔄 경기 초기화</div>
                              <div style={{color:'#fff'}}>L-Stick 클릭</div>

                              <div style={{color:'#f0f'}}>⚖️ 판정 우세 결정</div>
                              <div style={{color:'#fff'}}>L-Stick 왼쪽</div>

                              <div style={{color:'#0f0'}}>⏱ 시간 리셋</div>
                              <div style={{color:'#fff'}}>R-Stick 클릭</div>

                              <div style={{color:'#FFD700'}}>☕ 휴식</div>
                              <div style={{color:'#fff'}}>R-Stick 아래로</div>

                              <div style={{color:'#0f0'}}>🔄 다음 회전</div>
                              <div style={{color:'#fff'}}>R-Stick 오른쪽</div>

                              <div style={{color:'#0f0'}}>🔄 이전 회전</div>
                              <div style={{color:'#fff'}}>R-Stick 왼쪽</div>

                              <div style={{color:'#FFD700'}}>⏱ 시간 변경 (1분/2분)</div>
                              <div style={{color:'#fff'}}>R-Stick 위로</div>
                          </div>
                          
                          {/* Minus Mode Indicator */}
                          <div style={{marginTop:'15px', padding:'10px', background: isMinusMode ? '#500' : '#222', borderRadius:'5px', border: isMinusMode ? '2px solid #f00' : '1px solid #444', transition: 'all 0.3s'}}>
                              <div style={{fontSize:'1.1rem', fontWeight:'bold', color: isMinusMode ? '#fff' : '#888'}}>
                                  {isMinusMode ? "⚠️ 마이너스 모드 활성화 (점수/벌칙 차감)" : "일반 모드 (점수/벌칙 추가)"}
                              </div>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* Button Check Modal */}
      {showButtonCheckModal && (
          <div style={styles.modalOverlay}>
              <div style={styles.modalContent}>
                   <div style={styles.modalHeader}>
                    <h3>버튼 점검 모드 (Button Check)</h3>
                    <button onClick={() => setShowButtonCheckModal(false)} style={styles.closeBtn}>완료</button>
                  </div>
                  <p style={{color:'#f99', textAlign:'center', marginBottom:'20px'}}>
                      ※ 이 모드에서는 점수가 기록되지 않습니다.<br/>
                      부심들이 버튼을 누르면 아래 표에 불이 들어옵니다.
                  </p>
                  
                  <div style={{display:'flex', flexDirection:'column', gap:'10px', maxHeight:'400px', overflowY:'auto'}}>
                      {[1, 2, 3, 4, 5].map(id => (
                          <div key={id} style={{display:'flex', alignItems:'center', background:'#333', padding:'10px', borderRadius:'5px'}}>
                              <div style={{width:'80px', fontWeight:'bold', color: judgeConnectionStatus[id] ? '#fff' : '#888'}}>
                                  부심 {id} {judgeConnectionStatus[id] ? '(연결)' : '(대기)'}
                              </div>
                              <div style={{flex:1, display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'5px'}}>
                                  {/* Red */}
                                  <div style={{
                                      background: (buttonCheckState[`${id}-red-1`] || buttonCheckState[`${id}-red-2`]) ? '#f00' : '#200',
                                      color: '#fff', textAlign:'center', padding:'10px', borderRadius:'4px',
                                      border: '1px solid #500', transition: 'background 0.1s'
                                  }}>홍 (RED)</div>
                                  {/* Blue */}
                                  <div style={{
                                      background: (buttonCheckState[`${id}-blue-1`] || buttonCheckState[`${id}-blue-2`]) ? '#00f' : '#001',
                                      color: '#fff', textAlign:'center', padding:'10px', borderRadius:'4px',
                                      border: '1px solid #005', transition: 'background 0.1s'
                                  }}>청 (BLUE)</div>
                              </div>
                          </div>
                      ))}
                  </div>
                  <div style={{marginTop:'20px', textAlign:'center'}}>
                      <button onClick={() => setShowButtonCheckModal(false)} style={styles.mainActionBtn}>점검 완료 (Close)</button>
                  </div>
              </div>
          </div>
      )}


      {/* WINNER CONFIRMATION MODAL */}
      {matchResult && (
          <div style={styles.modalOverlay}>
              <div style={{...styles.modalContent, textAlign: 'center', maxWidth: '500px'}}>
                  <h2 style={{color: '#FFD700', fontSize: '2rem', marginBottom: '20px', borderBottom: '1px solid #444', paddingBottom: '10px'}}>경기 종료 (Match End)</h2>
                  <div style={{fontSize: '1.8rem', color: '#fff', marginBottom: '20px', fontWeight: 'bold'}}>
                      {matchResult}
                  </div>
                  <p style={{color: '#aaa', marginBottom: '30px', fontSize: '1.1rem'}}>
                      {matchInfo ? (
                          <>승자를 대진표에 반영하고<br/>계체 프로그램으로 돌아가시겠습니까?</>
                      ) : (
                          <>대진표 정보가 없습니다.<br/>계체 프로그램으로 돌아가시겠습니까?</>
                      )}
                  </p>
                  <div style={{display: 'flex', gap: '15px', justifyContent: 'center'}}>
                      <button 
                          onClick={handleConfirmWinner}
                          style={{...styles.mainActionBtn, background: '#FFD700', color: '#000', padding: '15px 30px', 
                            borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none'}}
                      >
                          {matchInfo ? '승자 확정 및 복귀' : '복귀'}
                      </button>
                      <button 
                          onClick={() => {
                            setIsManualOverride(true);
                            setMatchResult(null);
                          }}
                          style={{...styles.subActionBtn, padding: '15px 30px', background: '#444', color: '#fff', 
                            borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none'}}
                      >
                          취소 (점수 수정)
                      </button>
                  </div>
              </div>
          </div>
      )}


      {/* HEADER */}
      <div style={styles.headerBoard}>
        <div style={{ position: 'absolute', top: '5px', left: '10px', display: 'flex', gap: '10px', zIndex: 10 }}>
            <button onClick={() => navigate('/')} style={styles.homeBtnStatic}>🏠</button>
            <button onClick={() => setShowHistory(true)} style={styles.logBtnStatic}>
                SCORE BOARD (LOG)
            </button>
        </div>
        <div style={styles.modeIndicator}>
            🥊 대련경기
        </div>
        {isEditingTournamentName ? (
            <input 
                value={tournamentName || ''} onChange={e => setTournamentName(e.target.value)}
                onBlur={() => setIsEditingTournamentName(false)}
                style={styles.headerTitleInput} placeholder="대회명을 입력하세요"
                autoFocus
            />
        ) : (
            <div style={{...styles.headerTitleInput, cursor: 'pointer'}} onClick={() => setIsEditingTournamentName(true)}>
                {tournamentName || "대회명을 입력하세요"}
            </div>
        )}
        <div style={styles.infoGrid}>
            <div style={styles.infoCell}><span style={{fontSize:'0.8rem', color:'#aaa'}}>No.</span><input value={matchNo || ''} onChange={e => setMatchNo(e.target.value)} style={styles.infoInput}/></div>
            {[1, 2, 3].map(r => (
                <div key={r} onClick={() => setCurrentRound(r)} style={{...styles.infoCell, backgroundColor: currentRound === r ? '#fff' : '#000', color: currentRound === r ? '#000' : '#fff', cursor: 'pointer'}}>
                    {r === 3 ? '선득점제' : `${r}회전`}
                </div>
            ))}
            <div style={styles.infoCell}><input value={weightClass || ''} onChange={e => setWeightClass(e.target.value)} style={{...styles.infoInput, textAlign:'center'}}/></div>
        </div>
      </div>

      {/* LOG HISTORY MODAL */}
      {showHistory && (
          <div style={styles.modalOverlay}>
              <div style={styles.modalContent}>
                  <div style={styles.modalHeader}>
                    <h3 style={{margin:0}}>경기 기록 (Match Log)</h3>
                    <button onClick={() => setShowHistory(false)} style={styles.closeBtn}>X</button>
                  </div>
                  <div style={{display:'flex', marginBottom:'10px', borderBottom:'1px solid #444'}}>
                      <button onClick={() => setHistoryTab('score')} style={{...styles.tabBtn, borderBottom: historyTab === 'score' ? '2px solid #FFD700' : 'none', color: historyTab === 'score' ? '#FFD700' : '#888'}}>득점 기록</button>
                      <button onClick={() => setHistoryTab('input')} style={{...styles.tabBtn, borderBottom: historyTab === 'input' ? '2px solid #FFD700' : 'none', color: historyTab === 'input' ? '#FFD700' : '#888'}}>입력 기록</button>
                  </div>
                  <div style={styles.logList}>
                      {historyTab === 'score' ? (
                          logs.length === 0 ? <p style={{textAlign:'center', color:'#888'}}>득점 기록이 없습니다.</p> : logs.map(log => (
                            <div key={log.id} style={styles.logItem}><span style={styles.logTime}>[{log.time}]</span><span>{log.message}</span></div>
                          ))
                      ) : (
                          buttonLogs.length === 0 ? <p style={{textAlign:'center', color:'#888'}}>입력 기록이 없습니다.</p> : buttonLogs.map(log => (
                            <div key={log.id} style={styles.logItem}><span style={styles.logTime}>[{log.time}]</span><span>{log.message}</span></div>
                          ))
                      )}
                  </div>
                  {/* Moved Sound Button Here */}
                  <div style={{marginTop:'15px', paddingTop:'10px', borderTop:'1px solid #444', display:'flex', flexDirection:'column', gap:'10px'}}>
                      {/* Start Buzzer */}
                      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                          <div style={{fontSize:'0.9rem', color:'#aaa'}}>시작 부저음 (Start Sound)</div>
                           <input 
                            type="file" 
                            ref={startFileInputRef} 
                            style={{display:'none'}} 
                            accept="audio/*" 
                            onChange={(e) => handleFileChange(e, 'start')}
                          />
                          <button 
                            onClick={() => startFileInputRef.current?.click()} 
                            style={{...styles.subActionBtn, flex:'0 0 auto', padding:'5px 15px', background:'#333', border:'1px solid #888'}}
                          >
                            {hasStartCustomSound ? "🔔 시작음 변경 (Changed)" : "🔔 시작음 선택"}
                          </button>
                      </div>

                      {/* Stop Buzzer */}
                      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                          <div style={{fontSize:'0.9rem', color:'#aaa'}}>정지/종료 부저음 (Stop Sound)</div>
                           <input 
                            type="file" 
                            ref={stopFileInputRef} 
                            style={{display:'none'}} 
                            accept="audio/*" 
                            onChange={(e) => handleFileChange(e, 'stop')}
                          />
                          <button 
                            onClick={() => stopFileInputRef.current?.click()} 
                            style={{...styles.subActionBtn, flex:'0 0 auto', padding:'5px 15px', background:'#333', border:'1px solid #888'}}
                          >
                            {hasStartCustomSound ? "🔔 정지음 변경 (Changed)" : "🔔 정지음 선택"}
                          </button>
                      </div>
                      
                      {/* Wireless & Button Check Buttons Moved Here */}
                      <div style={{display:'flex', gap:'5px', marginTop:'5px'}}>
                           <button onClick={() => setShowConnectModal(true)} style={{...styles.subActionBtn, background:'#333', border:'1px solid #FFD700', color:'#FFD700', flex: 1, padding:'8px'}}>
                              📡 무선 연결
                           </button>
                           <button onClick={() => setShowButtonCheckModal(true)} style={{...styles.subActionBtn, background:'#333', border:'1px solid #aaa', color:'#fff', flex: 1, padding:'8px'}}>
                              🎮 버튼 점검
                           </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* AI CONFIG MODAL REMOVED - INTEGRATED INTO LOG MODAL */}

      {/* AI DISAGREE MODAL REMOVED */}

      {/* MAIN DISPLAY */}
      <div style={styles.mainDisplay}>
        <div style={{...styles.playerCard, background: '#E60000'}}>
             {redPlayer.disqualified && <div style={styles.dqOverlay}>실격</div>}
             {/* SCORE DISPLAY: Hidden if Hosinsul and not revealed */}
             <div style={styles.bigScore}>
                 {gameMode === 'hosinsul' && !isScoreRevealed ? '0' : redPlayer.score}
             </div>
             <div style={styles.playerInfoBox}>
                 <input value={redPlayer.name || ''} onChange={e => setRedPlayer({...redPlayer, name: e.target.value})} style={styles.playerName} placeholder="RED 선수명"/>
                 <input value={redPlayer.region || ''} onChange={e => setRedPlayer({...redPlayer, region: e.target.value})} style={styles.playerRegion} placeholder="소속"/>
             </div>
             {gameMode === 'sparring' && (
                 <div style={{position:'absolute', top:'20px', left:'20px', display:'flex', gap:'15px'}}>
                    <div style={styles.penaltyIndicatorGroup}><div style={styles.penaltyLabel}>감점</div>{renderCircles(redPlayer.gamjeom, '#ff0000')}</div>
                    <div style={styles.penaltyIndicatorGroup}><div style={styles.penaltyLabel}>경고</div>{renderCircles(redPlayer.kyonggo, '#FFD700')}</div>
                 </div>
             )}
        </div>

        <div style={{...styles.playerCard, background: '#0047BB'}}>
             {bluePlayer.disqualified && <div style={styles.dqOverlay}>실격</div>}
             <div style={styles.bigScore}>
                 {gameMode === 'hosinsul' && !isScoreRevealed ? '0' : bluePlayer.score}
             </div>
             <div style={styles.playerInfoBox}>
                 <input value={bluePlayer.name || ''} onChange={e => setBluePlayer({...bluePlayer, name: e.target.value})} style={styles.playerName} placeholder="BLUE 선수명"/>
                 <input value={bluePlayer.region || ''} onChange={e => setBluePlayer({...bluePlayer, region: e.target.value})} style={styles.playerRegion} placeholder="소속"/>
             </div>
             {gameMode === 'sparring' && (
                 <div style={{position:'absolute', top:'20px', right:'20px', display:'flex', gap:'15px'}}>
                    <div style={styles.penaltyIndicatorGroup}><div style={styles.penaltyLabel}>경고</div>{renderCircles(bluePlayer.kyonggo, '#FFD700')}</div>
                    <div style={styles.penaltyIndicatorGroup}><div style={styles.penaltyLabel}>감점</div>{renderCircles(bluePlayer.gamjeom, '#ff0000')}</div>
                 </div>
             )}
        </div>

        {gameMode === 'sparring' && (
            <div style={styles.centerOverlay}>
                <div style={styles.roundBox}>
                    {isResting ? (
                        <div style={{display:'flex', flexDirection:'column', alignItems:'center', lineHeight:1}}>
                            <span style={{fontSize:'0.8rem'}}>{timerMode === 'decision' ? '판정' : '휴식'}</span><span style={{fontSize:'1.3rem', color:'#d00'}}>{(restTimeLeft/10).toFixed(1)}</span>
                        </div>
                    ) : (!isRunning && !finalResultText && timeLeft > 0 && timeLeft < roundDuration * 10) ? <span style={{fontSize:'1.4rem'}}>정지</span> : currentRound}
                </div>
                
                <div style={styles.timerBox}>
                  {timerMode === 'firstToScore' && (
                    <div style={{ color: '#FFD700', fontSize: '0.8rem', fontWeight: 'bold', position: 'absolute', top: '-15px', left: '50%', transform: 'translateX(-50%)', width: '100%' }}>선득점제</div>
                  )}
                  {formatTime(timeLeft)}
                </div>
                {finalResultText && (
                    <div style={finalResultText === "경기 종료" ? styles.timeOverBanner : styles.resultBanner}>
                        {finalResultText}
                    </div>
                )}
            </div>
        )}

        {/* Center Overlay for Hosinsul Result */}
        {gameMode === 'hosinsul' && finalResultText && (
            <div style={styles.centerOverlay}>
                 <div style={styles.resultBanner}>{finalResultText}</div>
            </div>
        )}
      </div>

      {/* CONTROL PANEL */}
      <div style={styles.controlPanel}>
        <div style={styles.controlGroupRed}>
            <div style={styles.controlHeader}>홍 (RED)</div>
            
            {/* SPARRING ONLY: Penalty */}
            {gameMode === 'sparring' && (
                <div style={styles.penaltyControlRow}>
                    <div style={{display:'flex', alignItems:'center', gap:'5px'}}><span style={{fontSize:'0.8rem'}}>감점</span><button onClick={() => handleGamjeom('red', -1)} style={styles.miniBtn}>-</button><button onClick={() => handleGamjeom('red', 1)} style={styles.miniBtn}>+</button></div>
                    <div style={{display:'flex', alignItems:'center', gap:'5px'}}><span style={{fontSize:'0.8rem'}}>경고</span><button onClick={() => handleKyonggo('red', -1)} style={styles.miniBtn}>-</button><button onClick={() => handleKyonggo('red', 1)} style={styles.miniBtn}>+</button></div>
                </div>
            )}

            {/* SPARRING: Judge Buttons */}
            {gameMode === 'sparring' && (
                <div style={{display:'flex', gap:'5px', marginTop:'10px'}}>
                    {redJudges.slice(0, 3).map(j => {
                        const { style, text } = getJudgeBtnStyle(j, 'red');
                        return <div key={j.id} style={{...style, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{text}</div>;
                    })}
                </div>
            )}

            {/* HIDE JUDGE BUTTONS IN HOSINSUL UNTIL REVEALED */}
            {gameMode === 'hosinsul' && (
                <div style={{display:'flex', gap:'5px', marginTop:'10px'}}>
                    {redJudges.map(j => { 
                        if (!isScoreRevealed) return <div key={j.id} style={{flex:1, height:'50px'}}></div>; // Placeholder
                        const { style, text } = getJudgeBtnStyle(j, 'red'); 
                        return <div key={j.id} style={{...style, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{text}</div>; 
                    })}
                </div>
            )}
        </div>

        <div style={styles.controlGroupCenter}>
            <div style={styles.controlHeader}>경기 운영</div>
            
            {/* HOSINSUL SPECIFIC CENTER CONTROLS */}
            {gameMode === 'hosinsul' && (
                <div style={{width:'100%', marginBottom:'10px'}}>
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:'10px', padding:'0 5px'}}>
                        {[1, 2, 3, 4, 5].map(id => {
                            const voted = getJudgeVotingStatus(id);
                            return (
                                <div key={id} style={{
                                    width:'30px', height:'30px', borderRadius:'50%', 
                                    background: voted ? '#0f0' : '#444', color: voted ? '#000' : '#888',
                                    display:'flex', alignItems:'center', justifyContent:'center',
                                    fontWeight:'bold', fontSize:'0.8rem', border: voted ? '2px solid #fff' : '1px solid #666'
                                }}>
                                    {id}
                                </div>
                            );
                        })}
                    </div>
                    
                    <button 
                        onClick={() => setIsScoreRevealed(!isScoreRevealed)} 
                        style={{
                            ...styles.mainActionBtn, 
                            background: isScoreRevealed ? '#555' : '#FFD700', 
                            color: isScoreRevealed ? '#fff' : '#000',
                            borderTop: isScoreRevealed ? '1px solid #777' : 'none',
                            borderLeft: isScoreRevealed ? '1px solid #777' : 'none',
                            borderRight: isScoreRevealed ? '1px solid #777' : 'none',
                            borderBottom: isScoreRevealed ? '1px solid #777' : 'none',
                            marginBottom: '10px',
                            boxShadow: isScoreRevealed ? 'none' : '0 0 10px rgba(255, 215, 0, 0.5)'
                        }}
                    >
                        {isScoreRevealed ? '결과 숨기기' : '✨ 판정 공개 (Reveal)'}
                    </button>

                                {/* AI evaluation disabled */}
                </div>
            )}

            {/* SPARRING ONLY: Time Controls */}
            {gameMode === 'sparring' && (
                <>
                <div style={{display:'flex', gap:'5px', width:'100%', marginBottom:'10px', alignItems: 'center'}}>
                    <span style={{fontSize:'0.8rem', color:'#aaa'}}>시간:</span>
                    <button onClick={() => { setRoundDuration(60); setTimeLeft(600); setIsRunning(false); }} style={{...styles.subActionBtn, background: roundDuration === 60 ? '#666' : '#333', color: roundDuration === 60 ? '#fff' : '#ccc', flex: 1}}>1분</button>
                    <button onClick={() => { setRoundDuration(120); setTimeLeft(1200); setIsRunning(false); }} style={{...styles.subActionBtn, background: roundDuration === 120 ? '#666' : '#333', color: roundDuration === 120 ? '#fff' : '#ccc', flex: 1}}>2분</button>
                </div>
                <div style={{display:'flex', gap:'10px', width:'100%', marginBottom:'10px'}}>
                    <button onClick={handleStartPause} style={styles.mainActionBtn}>{isRunning ? '일시정지' : '시작'}</button>
                    <button onClick={handleRest} style={{...styles.mainActionBtn, background:'#555', color:'#fff', flex: 0.4, fontSize:'1rem'}}>휴식</button>
                </div>
                </>
            )}

            <div style={{display:'flex', gap:'5px', width:'100%'}}>
                 {gameMode === 'sparring' && <button onClick={() => {setIsRunning(false); setTimeLeft(roundDuration * 10);}} style={styles.subActionBtn}>시간리셋</button>}
                 <button onClick={resetMatch} style={{...styles.subActionBtn, color:'#ff8888'}}>경기 초기화</button>
            </div>

             {/* Mini Status Indicators in Main Panel */}
             <div style={{display:'flex', justifyContent:'center', gap:'5px', marginTop:'5px', fontSize:'0.7rem', color:'#888', flexWrap:'wrap'}}>
                 {[1, 2, 3, 4, 5].map(id => (
                    <div key={id} style={{display:'flex', alignItems:'center', gap:'3px', color: judgeConnectionStatus[id] ? '#0f0' : '#555'}}>
                        <div style={{width:'6px', height:'6px', borderRadius:'50%', background: judgeConnectionStatus[id] ? '#0f0' : '#555'}}></div>
                        부심{id}
                    </div>
                 ))}
             </div>

            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'5px', padding:'0 5px'}}>
                <span style={{fontSize:'0.7rem', color:'#aaa'}}>경기 로그</span>
            </div>
            
            <div style={{height:'30px', width:'100%', background:'#222', marginTop:'5px', overflowY:'auto', padding:'5px', fontSize:'0.75rem', fontFamily:'monospace'}}>
                {logs.map(log => <div key={log.id} style={{borderBottom:'1px solid #333', padding:'2px'}}>[{log.time}] {log.message}</div>)}
            </div>
        </div>

        <div style={styles.controlGroupBlue}>
            <div style={styles.controlHeader}>청 (BLUE)</div>
            
            {/* SPARRING ONLY: Penalty */}
            {gameMode === 'sparring' && (
                <div style={styles.penaltyControlRow}>
                    <div style={{display:'flex', alignItems:'center', gap:'5px'}}><span style={{fontSize:'0.8rem'}}>감점</span><button onClick={() => handleGamjeom('blue', -1)} style={styles.miniBtn}>-</button><button onClick={() => handleGamjeom('blue', 1)} style={styles.miniBtn}>+</button></div>
                    <div style={{display:'flex', alignItems:'center', gap:'5px'}}><span style={{fontSize:'0.8rem'}}>경고</span><button onClick={() => handleKyonggo('blue', -1)} style={styles.miniBtn}>-</button><button onClick={() => handleKyonggo('blue', 1)} style={styles.miniBtn}>+</button></div>
                </div>
            )}

            {/* SPARRING: Judge Buttons */}
            {gameMode === 'sparring' && (
                <div style={{display:'flex', gap:'5px', marginTop:'10px'}}>
                    {blueJudges.slice(0, 3).map(j => {
                        const { style, text } = getJudgeBtnStyle(j, 'blue');
                        return <div key={j.id} style={{...style, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{text}</div>;
                    })}
                </div>
            )}

            {/* HIDE JUDGE BUTTONS IN HOSINSUL UNTIL REVEALED */}
            {gameMode === 'hosinsul' && (
                <div style={{display:'flex', gap:'5px', marginTop:'10px'}}>
                    {blueJudges.map(j => { 
                        if (!isScoreRevealed) return <div key={j.id} style={{flex:1, height:'50px'}}></div>; // Placeholder
                        const { style, text } = getJudgeBtnStyle(j, 'blue'); 
                        return <div key={j.id} style={{...style, cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{text}</div>; 
                    })}
                </div>
            )}
        </div>
      </div>

      {/* AI CONFIG MODAL REMOVED */}

      {/* AI DISAGREE MODAL REMOVED */}

    </div>
  );
};

// --- Styles ---
const styles: Record<string, React.CSSProperties> = {
  appContainer: {
    display: 'flex', flexDirection: 'column', height: '100vh',
    backgroundColor: '#000', fontFamily: '"Noto Sans KR", sans-serif',
    color: 'white', overflow: 'hidden'
  },
  headerBoard: {
    height: '140px', backgroundColor: '#000',
    display: 'flex', flexDirection: 'column',
    position: 'relative', borderBottom: '2px solid #333'
  },
  scoreBoardTag: {
    position: 'absolute', top: '5px', left: '70px', 
    backgroundColor: 'black', color: 'white', fontSize: '1.2rem', 
    fontWeight: '900', fontFamily: 'Oswald', zIndex: 10,
    border: '2px solid #333', cursor: 'pointer', padding: '5px 10px'
  },
  logBtn: {
    position: 'absolute', top: '5px', left: '70px',
    backgroundColor: 'black', color: 'white', fontSize: '1.2rem', 
    fontWeight: '900', fontFamily: 'Oswald', zIndex: 10,
    border: '2px solid #333', cursor: 'pointer', padding: '5px 10px'
  },
  logBtnStatic: {
    backgroundColor: 'black', color: 'white', fontSize: '1.2rem', 
    fontWeight: '900', fontFamily: 'Oswald',
    border: '2px solid #333', cursor: 'pointer', padding: '5px 10px'
  },
  homeBtn: {
    position: 'absolute', top: '5px', left: '10px',
    backgroundColor: '#333', color: 'white', fontSize: '1.2rem',
    fontWeight: 'bold', zIndex: 10, border: '1px solid #555',
    cursor: 'pointer', padding: '5px 10px', borderRadius: '5px'
  },
  homeBtnStatic: {
    backgroundColor: '#333', color: 'white', fontSize: '1.2rem',
    fontWeight: 'bold', border: '1px solid #555',
    cursor: 'pointer', padding: '5px 10px', borderRadius: '5px'
  },
  modeToggleBtn: {
    position: 'absolute', top: '5px', right: '10px',
    backgroundColor: '#333', color: '#FFD700', fontSize: '1.1rem',
    fontWeight: 'bold', zIndex: 10, border: '1px solid #FFD700',
    cursor: 'pointer', padding: '5px 15px', borderRadius: '20px'
  },
  headerTitleInput: {
    flex: 1, backgroundColor: 'transparent', 
    borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
    color: 'white', fontSize: '2.5rem', textAlign: 'center',
    fontWeight: 'bold', width: '100%', outline: 'none', marginTop: '10px'
  },
  infoGrid: {
    height: '40px', display: 'flex', borderTop: '2px solid #333',
    width: '80%', margin: '0 auto', borderLeft: '2px solid #333', borderRight: '2px solid #333'
  },
  infoCell: {
    flex: 1, borderRight: '1px solid #333', display: 'flex',
    alignItems: 'center', justifyContent: 'center', background: '#000',
    fontSize: '1rem', fontWeight: 'bold'
  },
  infoInput: {
    background: 'transparent', 
    borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
    color: '#fff', 
    textAlign: 'center', width: '60px', fontSize: '1rem', fontWeight: 'bold',
    outline: 'none'
  },
  modalOverlay: {
    position: 'fixed', top:0, left:0, width:'100%', height:'100%',
    backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100,
    display: 'flex', justifyContent: 'center', alignItems: 'center'
  },
  modalContent: {
    width: '900px', maxWidth: '95%', maxHeight: '95%', backgroundColor: '#222', 
    border: '2px solid #555', borderRadius: '10px', padding: '20px',
    display: 'flex', flexDirection: 'column', color: 'white',
    overflowY: 'auto'
  },
  modalInput: {
    padding: '10px', fontSize: '1.2rem', background: '#333', border: '1px solid #555', color: 'white'
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '10px', borderBottom: '1px solid #444', paddingBottom: '10px'
  },
  tabBtn: {
    flex: 1, padding: '10px', background: 'transparent', 
    borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
    fontSize: '1.1rem', fontWeight: 'bold', cursor: 'pointer'
  },
  closeBtn: {
    background: 'transparent', border: '1px solid #888', color: '#fff',
    cursor: 'pointer', fontSize: '1.2rem', padding: '5px 10px', borderRadius: '4px'
  },
  logList: {
    flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px'
  },
  logItem: {
    padding: '8px', borderBottom: '1px solid #333', display: 'flex', gap: '10px', alignItems: 'center'
  },
  logTime: {
    color: '#FFD700', fontWeight: 'bold', fontFamily: 'monospace'
  },
  mainDisplay: {
    flex: 3, display: 'flex', position: 'relative'
  },
  playerCard: {
    flex: 1, display: 'flex', flexDirection: 'column', 
    alignItems: 'center', justifyContent: 'center', position: 'relative'
  },
  bigScore: {
    fontSize: '20rem', fontWeight: 'bold', fontFamily: 'Oswald',
    lineHeight: 1, textShadow: '5px 5px 0px rgba(0,0,0,0.3)'
  },
  playerInfoBox: {
    position: 'absolute', bottom: '20px', 
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    width: '80%'
  },
  playerName: {
    background: 'transparent', 
    borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
    color: 'white',
    fontSize: '3rem', fontWeight: 'bold', textAlign: 'center', width: '100%',
    textShadow: '2px 2px 4px rgba(0,0,0,0.5)', outline: 'none'
  },
  playerRegion: {
    background: 'transparent', 
    borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
    color: 'rgba(255,255,255,0.8)',
    fontSize: '1.5rem', textAlign: 'center', width: '100%', outline: 'none'
  },
  centerOverlay: {
    position: 'absolute', top: '50%', left: '50%', 
    transform: 'translate(-50%, -50%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    zIndex: 20
  },
  roundBox: {
    backgroundColor: 'white', color: 'black', 
    fontSize: '2rem', fontWeight: 'bold', 
    minWidth: '50px', height: '50px', padding: '0 5px',
    display: 'flex', 
    alignItems: 'center', justifyContent: 'center',
    border: '2px solid black', marginBottom: '-2px'
  },
  timerBox: {
    position: 'relative',
    backgroundColor: 'black', color: '#FFD700',
    border: '2px solid #FFD700', padding: '10px 30px',
    fontSize: '5rem', fontFamily: 'Oswald', fontWeight: 'bold',
    lineHeight: 1, boxShadow: '0 0 20px rgba(0,0,0,0.8)'
  },
  resultBanner: {
    marginTop: '20px', background: '#fff', color: '#d00',
    padding: '10px 20px', fontSize: '2rem', fontWeight: '900',
    border: '5px solid #d00', whiteSpace: 'nowrap',
    animation: 'pulse 1s infinite'
  },
  timeOverBanner: {
    marginTop: '20px', background: '#E60000', color: '#fff',
    padding: '10px 30px', fontSize: '3rem', fontWeight: '900',
    border: '5px solid #fff', whiteSpace: 'nowrap',
    animation: 'blink 1s infinite',
    boxShadow: '0 0 20px rgba(255, 0, 0, 0.9)'
  },
  dqOverlay: {
    position: 'absolute', fontSize: '8rem', color: 'red',
    border: '10px solid red', padding: '20px', transform: 'rotate(-15deg)',
    fontWeight: '900', background: 'rgba(0,0,0,0.8)', zIndex: 15
  },
  penaltyIndicatorGroup: {
    display: 'flex', flexDirection: 'column', alignItems: 'center'
  },
  penaltyLabel: {
    fontSize: '0.8rem', marginBottom: '2px', fontWeight: 'bold', 
    textShadow: '1px 1px 2px black'
  },
  controlPanel: {
    height: '220px', backgroundColor: '#181818', borderTop: '4px solid #333',
    display: 'flex', padding: '10px', gap: '10px'
  },
  controlGroupRed: {
    flex: 1.2, backgroundColor: '#200', padding: '10px', borderRadius: '8px',
    display: 'flex', flexDirection: 'column', border: '1px solid #500'
  },
  controlGroupBlue: {
    flex: 1.2, backgroundColor: '#001', padding: '10px', borderRadius: '8px',
    display: 'flex', flexDirection: 'column', border: '1px solid #005'
  },
  controlGroupCenter: {
    flex: 1.5, backgroundColor: '#222', padding: '10px', borderRadius: '8px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', border: '1px solid #444'
  },
  controlHeader: {
    fontSize: '0.9rem', color: '#aaa', marginBottom: '5px', 
    textAlign: 'center', width: '100%', borderBottom: '1px solid rgba(255,255,255,0.1)'
  },
  penaltyControlRow: {
    display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '5px'
  },
  miniBtn: {
    width: '24px', height: '24px', padding: 0, fontSize: '1rem', 
    cursor: 'pointer', background: '#444', color: '#fff', 
    borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
    borderRadius: '4px'
  },
  judgeBtn: {
    flex: 1, padding: '15px 0', cursor: 'pointer', color: '#fff', 
    fontSize: '1rem', fontWeight: 'bold', borderRadius: '4px'
  },
  scoreBtn: {
    flex: 1, padding: '10px 0', cursor: 'pointer', color: '#fff',
    fontSize: '1.2rem', fontWeight: 'bold', border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: '4px'
  },
  mainActionBtn: {
    flex: 1, padding: '10px', fontSize: '1.2rem', fontWeight: 'bold',
    background: '#eee', color: '#000', cursor: 'pointer', 
    borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
    borderRadius: '4px'
  },
  subActionBtn: {
    flex: 1, padding: '5px', fontSize: '0.9rem',
    background: '#333', color: '#ccc', cursor: 'pointer', border: '1px solid #555', borderRadius: '4px'
  },
  // Remote Control Styles
  remoteBtn: {
    flex: 1, fontSize: '3rem', fontWeight: '900', color: 'white',
    borderRadius: '10px', cursor: 'pointer', display:'flex', alignItems:'center', justifyContent:'center',
    touchAction: 'manipulation' // prevent double tap zoom
  }
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
  <TournamentProvider>
    <BrowserRouter>
    <Routes>
      <Route path="/" element={<Launcher />} />
      <Route path="/scoreboard" element={<ScoreboardApp />} />
      <Route path="/hosinsul-scoreboard" element={<HosinsulScoreboardApp />} />
    </Routes>
  </BrowserRouter>
  </TournamentProvider>
);