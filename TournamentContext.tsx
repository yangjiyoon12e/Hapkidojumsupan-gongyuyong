import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// --- Constants & Types ---
export const SURNAMES = "김이박최정강조윤장임한오서신권황안송류전홍고문양손배조백허유남심노정하곽성차주우구신임나전민유진지엄채원천방공강현함변염양변여추노도소신석선설마길주연방위표명기반왕금옥육인맹제모장남탁국여진어은편구용".split("");
export const GIVEN_NAMES = [
  "민준", "서준", "도윤", "예준", "시우", "하준", "지호", "주원", "지우", "준우", "준서", "현우", "예성", "건우", "현준", "우진", "선우", "서진", "연우", "정우", 
  "승우", "승현", "시현", "준영", "유준", "승민", "지후", "성민", "준혁", "은우", "지훈", "재윤", "시윤", "동현", "수현", "재원", "민재", "현서", "도현", "건", 
  "지한", "지성", "승준", "서우", "현성", "준호", "승원", "민성", "우빈", "재민", "준", "민규", "지원", "승호", "규민", "시후", "진우", "민수", "은성", "재현", 
  "동훈", "성현", "민석", "준서", "지환", "승재", "태윤", "민찬", "시원", "우주", "재영", "성준", "민호", "시온", "예성", "지원", "승빈", "정민", "태현", "지율", 
  "민우", "재혁", "현수", "성훈", "규빈", "하민", "준성", "우성", "진호", "태민", "건호", "수민", "예승", "윤성", "민혁", "현민", "도훈", "상현", "영준", "서현", 
  "정현", "승후", "승윤", "태양", "은찬", "시율", "준희", "시훈", "동우", "승훈", "서원", "태준", "우림", "재우", "성빈", "은호", "민기", "예찬", "준수", "하진", 
  "지민", "성윤", "주혁", "민서", "도율", "시혁", "성진", "규림", "태성", "지안", "재성", "현진", "예담", "현승", "서율", "하율", "도영", "은솔", "지온", "예림", 
  "서윤", "수아", "하윤", "지아", "서연", "소서", "예은", "수빈", "지유", "예린", "민서", "하은", "윤서", "채원", "지우", "서현", "규리", "다은", "은서", "지민", 
  "서영", "윤아", "예원", "예서", "지원", "수진", "소율", "지현", "예진", "채은", "수민", "지윤", "은지", "시은", "민지", "연우", "하린", "다인", "예나", "유진", 
  "수현", "소윤", "민주", "지수", "민아", "나은", "혜원", "서은", "예지", "다연", "서진", "수영", "주아", "시아", "채윤", "유나", "다현", "서아", "민채", "소은", 
  "나연", "승아", "채율", "서희", "연아", "소담", "예빈", "지율", "하윤", "태희", "민하", "사랑", "시온"
];

export const GYM_PREFIXES = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", 
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"
];

export const REAL_GYM_NAMES = [
  "JE양우합기도", "JTA무림합기도팀", "강호체육관팀", "강호합기도팀", "국무원합기도체육관",
  "군산강호합기도팀", "금강합기도팀", "금빛합기도팀", "다온합기도팀", "대구화랑합기도팀",
  "대덕합기도장팀", "대한합기도팀", "드림팀합기도팀", "드림합기도팀(남산 )", "라이온경찰합기도팀",
  "라이온합기도검무관팀", "멀티오짐팀", "명성합기도팀", "명품타이거즈팀", "무극멀티짐팀",
  "무림합기도팀", "무무관 화랑합기도장팀", "영직체육관", "영통합기도2팀", "용인대동양합기도",
  "용인대서림합기도팀", "용호문합기도팀", "용호체육관 팀", "울진합기도수덕관팀", "을지관 인무도장팀",
  "일무관합기도팀", "일무합기도_팀", "전북합기도팀", "정무관합기도팀", "죽전합기도팀",
  "참좋은신방합기도팀", "천무도담합기도팀", "천안합기도연무관/팀", "천안화랑합기도팀", "천지관도안합기도팀",
  "청학합기도팀", "최강합기도천지관팀", "충의합기도팀", "컴뱃합기도진무관팀", "타이거 합기도",
  "쌍용합기도", "청산관합기도"
];

export const DIVISIONS = [
  { id: 'elem_low', name: '초등부(저)', gender: 'mixed', weights: ['-25kg', '-30kg', '-35kg', '+35kg'] },
  { id: 'elem_high', name: '초등부(고)', gender: 'mixed', weights: ['-30kg', '-35kg', '-40kg', '-45kg', '+45kg'] },
  { id: 'middle_m', name: '중등부(남)', gender: 'male', weights: ['-45kg', '-48kg', '-51kg', '-55kg', '-59kg', '-63kg', '-68kg', '-73kg', '-78kg', '+78kg'] },
  { id: 'middle_f', name: '중등부(여)', gender: 'female', weights: ['-40kg', '-43kg', '-46kg', '-49kg', '-53kg', '-58kg', '-63kg', '+63kg'] },
  { id: 'high_m', name: '고등부(남)', gender: 'male', weights: ['-51kg', '-55kg', '-59kg', '-63kg', '-68kg', '-73kg', '-78kg', '+78kg'] },
  { id: 'high_f', name: '고등부(여)', gender: 'female', weights: ['-46kg', '-49kg', '-53kg', '-58kg', '-63kg', '-68kg', '+68kg'] },
  { id: 'adult_m', name: '일반부(남)', gender: 'male', weights: ['-58kg', '-63kg', '-68kg', '-75kg', '-85kg', '+85kg'] },
  { id: 'adult_f', name: '일반부(여)', gender: 'female', weights: ['-50kg', '-55kg', '-60kg', '-65kg', '+65kg'] },
  { id: 'hosinsul_elem', name: '호신술(초등)', gender: 'mixed', weights: ['1종목', '2종목', '3종목'] },
  { id: 'hosinsul_middle', name: '호신술(중등)', gender: 'mixed', weights: ['1종목', '2종목', '3종목'] },
  { id: 'hosinsul_high', name: '호신술(고등)', gender: 'mixed', weights: ['1종목', '2종목', '3종목'] },
  { id: 'hosinsul_adult', name: '호신술(일반)', gender: 'mixed', weights: ['1종목', '2종목', '3종목'] },
];

export type ParticipantStatus = 'pending' | 'pass' | 'fail' | 'absent' | 'retest';

export interface Participant {
  id: number;
  name: string;
  gym: string;
  division: string;
  gender: '남' | '여';
  weightClass: string;
  status: ParticipantStatus;
  measuredWeight?: string;
  barcode?: string;
  receiver?: string;
}

export interface Match {
  id: string;
  p1: Participant | null;
  p2: Participant | null;
  isBye: boolean;
  winnerId?: number; // ID of the winner
  winner?: Participant | null; // The whole winner object
  result?: string; // The result string
  isFirstToScore?: boolean;
  isRematch?: boolean;
  matchNumberSuffix?: string;
}

export interface Round {
  roundNum: number;
  name: string;
  matches: Match[];
}

interface TournamentContextType {
  participants: Participant[];
  setParticipants: React.Dispatch<React.SetStateAction<Participant[]>>;
  brackets: Record<string, Round[]>; // Key: "Division-Weight"
  setBrackets: React.Dispatch<React.SetStateAction<Record<string, Round[]>>>;
  getBracket: (division: string, weight: string) => Round[];
  generateBracket: (division: string, weight: string) => void;
  updateMatchWinner: (division: string, weight: string, matchId: string, winnerId: number) => void;
  tournamentName: string;
  setTournamentName: (name: string) => void;
  updateMatchMode: (division: string, weight: string, matchId: string, mode: 'firstToScore' | 'rematch' | 'normal') => void;
  resetTournament: () => void;
}

const TournamentContext = createContext<TournamentContextType | undefined>(undefined);

export const TournamentProvider = ({ children }: { children: ReactNode }) => {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [brackets, setBrackets] = useState<Record<string, Round[]>>({});
  const [tournamentName, setTournamentName] = useState<string>(() => {
    return localStorage.getItem('tournamentName') || '제1회 대한민국 합기도 대회';
  });

  const generateParticipants = (): Participant[] => {
    const sparringDivs = DIVISIONS.filter(d => !d.id.startsWith('hosinsul'));
    const hosinsulDivs = DIVISIONS.filter(d => d.id.startsWith('hosinsul'));
    
    const totalTarget = Math.floor(Math.random() * 301) + 1200; // 1200 to 1500
    const ratios = [[6, 5], [5, 5], [5, 6]];
    const selectedRatio = ratios[Math.floor(Math.random() * ratios.length)];
    const sum = selectedRatio[0] + selectedRatio[1];
    
    const sparringTarget = Math.floor(totalTarget * (selectedRatio[0] / sum));
    const hosinsulTarget = totalTarget - sparringTarget;

    const candidates: Participant[] = [];
    
    // Generate Sparring
    for (let i = 0; i < sparringTarget; i++) {
      const surname = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
      const givenName = GIVEN_NAMES[Math.floor(Math.random() * GIVEN_NAMES.length)];
      const region = GYM_PREFIXES[Math.floor(Math.random() * GYM_PREFIXES.length)];
      const gymName = REAL_GYM_NAMES[Math.floor(Math.random() * REAL_GYM_NAMES.length)];
      const division = sparringDivs[Math.floor(Math.random() * sparringDivs.length)];
      const weight = division.weights[Math.floor(Math.random() * division.weights.length)];
      
      candidates.push({
        id: candidates.length + 1,
        name: `${surname}${givenName}`,
        gym: `${region} ${gymName}`,
        division: division.name,
        gender: division.gender === 'male' ? '남' : (division.gender === 'female' ? '여' : (Math.random() > 0.5 ? '남' : '여')),
        weightClass: weight,
        status: 'pending'
      });
    }

    // Generate Hosinsul
    for (let i = 0; i < hosinsulTarget; i++) {
      const surname = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
      const givenName = GIVEN_NAMES[Math.floor(Math.random() * GIVEN_NAMES.length)];
      const region = GYM_PREFIXES[Math.floor(Math.random() * GYM_PREFIXES.length)];
      const gymName = REAL_GYM_NAMES[Math.floor(Math.random() * REAL_GYM_NAMES.length)];
      const division = hosinsulDivs[Math.floor(Math.random() * hosinsulDivs.length)];
      const weight = division.weights[Math.floor(Math.random() * division.weights.length)];
      
      candidates.push({
        id: candidates.length + 1,
        name: `${surname}${givenName}`,
        gym: `${region} ${gymName}`,
        division: division.name,
        gender: '남',
        weightClass: weight,
        status: 'pending'
      });
    }

    return candidates;
  };

  useEffect(() => {
    localStorage.setItem('tournamentName', tournamentName);
  }, [tournamentName]);

  // Initialize participants on mount
  useEffect(() => {
    const savedParticipants = localStorage.getItem('participants');
    if (savedParticipants) {
      try {
        setParticipants(JSON.parse(savedParticipants));
      } catch (e) {
        setParticipants(generateParticipants());
      }
    } else {
      setParticipants(generateParticipants());
    }
  }, []);

  // Save participants to localStorage whenever they change
  useEffect(() => {
    if (participants.length > 0) {
      localStorage.setItem('participants', JSON.stringify(participants));
    }
  }, [participants]);

  // Initialize brackets from localStorage on mount
  useEffect(() => {
    const savedBrackets = localStorage.getItem('brackets');
    if (savedBrackets) {
      try {
        setBrackets(JSON.parse(savedBrackets));
      } catch (e) {
        console.error('Failed to parse brackets from localStorage', e);
      }
    }
  }, []);

  // Save brackets to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('brackets', JSON.stringify(brackets));
  }, [brackets]);

  const getBracket = (division: string, weight: string) => {
    const key = `${division}-${weight}`;
    return brackets[key] || [];
  };

  const generateBracket = (division: string, weight: string) => {
    const key = `${division}-${weight}`;
    if (brackets[key] && brackets[key].length > 0) return; // Already exists

    const targetParticipants = participants.filter(
      p => p.division === division && p.weightClass === weight
    );

    if (targetParticipants.length === 0) {
      setBrackets(prev => ({ ...prev, [key]: [] }));
      return;
    }

    // Shuffle for random seeding
    const shuffled = [...targetParticipants].sort(() => Math.random() - 0.5);
    
    const n = shuffled.length;
    let size = 1;
    while (size < n) size *= 2;

    // Fill slots with participants and nulls (byes)
    const slots: (Participant | null)[] = new Array(size).fill(null);
    for (let i = 0; i < n; i++) {
      slots[i] = shuffled[i];
    }

    const rounds: Round[] = [];
    let currentSlots = slots;
    let roundNum = 1;

    // Generate rounds until 1 match remains (Final)
    while (currentSlots.length > 1) {
      const matches: Match[] = [];
      const nextSlots = [];

      for (let i = 0; i < currentSlots.length; i += 2) {
        const p1 = currentSlots[i];
        const p2 = currentSlots[i+1];

        // Determine winner/next slot placeholder
        let winnerPlaceholder: any = null;
        let matchWinnerId: number | undefined = undefined;

        if (p1 && !p2) {
            winnerPlaceholder = p1;
            matchWinnerId = p1.id;
        } else if (!p1 && p2) {
            winnerPlaceholder = p2;
            matchWinnerId = p2.id;
        } else if (!p1 && !p2) {
            winnerPlaceholder = null;
        } else {
            winnerPlaceholder = { name: '승자', isPlaceholder: true };
        }

        matches.push({
          id: `라운드 ${roundNum}-경기 ${i/2 + 1}`,
          p1,
          p2,
          isBye: !p1 || !p2,
          winnerId: matchWinnerId
        });

        nextSlots.push(winnerPlaceholder);
      }

      rounds.push({
        roundNum,
        name: currentSlots.length === 2 ? '결승' : 
              currentSlots.length === 4 ? '4강' : 
              currentSlots.length === 8 ? '8강' : 
              `${currentSlots.length}강`,
        matches
      });
      
      currentSlots = nextSlots;
      roundNum++;
    }

    setBrackets(prev => ({ ...prev, [key]: rounds }));
  };

  const updateMatchWinner = (division: string, weight: string, matchId: string, winnerId: number) => {
    const key = `${division}-${weight}`;
    const currentBracket = brackets[key];
    if (!currentBracket) return;

    // Deep copy to avoid mutation issues
    const newBracket = JSON.parse(JSON.stringify(currentBracket)) as Round[];

    // Find the match and set winner
    let foundRoundIndex = -1;
    let foundMatchIndex = -1;
    let winner: Participant | null = null;

    for (let r = 0; r < newBracket.length; r++) {
        const mIdx = newBracket[r].matches.findIndex(m => m.id === matchId);
        if (mIdx !== -1) {
            foundRoundIndex = r;
            foundMatchIndex = mIdx;
            newBracket[r].matches[mIdx].winnerId = winnerId;
            
            const match = newBracket[r].matches[mIdx];
            if (match.p1 && match.p1.id === winnerId) winner = match.p1;
            else if (match.p2 && match.p2.id === winnerId) winner = match.p2;
            
            newBracket[r].matches[mIdx].winner = winner;
            break;
        }
    }

    if (foundRoundIndex !== -1 && winner && foundRoundIndex + 1 < newBracket.length) {
        // Advance winner to next round
        const nextRound = newBracket[foundRoundIndex + 1];
        // The match index in current round determines position in next round
        // Match 0 and 1 -> Next Match 0
        // Match 2 and 3 -> Next Match 1
        const nextMatchIndex = Math.floor(foundMatchIndex / 2);
        const isPlayer1Position = foundMatchIndex % 2 === 0;

        if (nextMatchIndex < nextRound.matches.length) {
            if (isPlayer1Position) {
                nextRound.matches[nextMatchIndex].p1 = winner;
            } else {
                nextRound.matches[nextMatchIndex].p2 = winner;
            }
        }
    }

    setBrackets(prev => ({ ...prev, [key]: newBracket }));
  };

  const updateMatchMode = (division: string, weight: string, matchId: string, mode: 'firstToScore' | 'rematch' | 'normal') => {
    const key = `${division}-${weight}`;
    const currentBracket = brackets[key];
    if (!currentBracket) return;

    const newBracket = JSON.parse(JSON.stringify(currentBracket)) as Round[];
    let foundRoundIndex = -1;
    let foundMatchIndex = -1;

    for (let r = 0; r < newBracket.length; r++) {
      const mIdx = newBracket[r].matches.findIndex(m => m.id === matchId);
      if (mIdx !== -1) {
        foundRoundIndex = r;
        foundMatchIndex = mIdx;
        const match = newBracket[r].matches[mIdx];
        
        // Reset winner for rematch/sudden death
        match.winnerId = undefined;
        match.winner = undefined;
        match.result = undefined;

        if (mode === 'firstToScore') {
          match.isFirstToScore = true;
          match.isRematch = false;
          match.matchNumberSuffix = ' (선득점제 재경기)';
        } else if (mode === 'rematch') {
          match.isRematch = true;
          match.isFirstToScore = false;
          match.matchNumberSuffix = ' (재경기)';
        } else {
          match.isFirstToScore = false;
          match.isRematch = false;
          match.matchNumberSuffix = '';
        }
        break;
      }
    }

    // If we reset a winner, we must clear them from the next round too (recursively)
    if (foundRoundIndex === -1) {
      setBrackets(prev => ({ ...prev, [key]: newBracket }));
      return;
    }

    let r = foundRoundIndex;
    let mIdx = foundMatchIndex;
    
    while (r + 1 < newBracket.length) {
      const nextRound = newBracket[r + 1];
      const nextMatchIndex = Math.floor(mIdx / 2);
      const isPlayer1Position = mIdx % 2 === 0;

      if (nextMatchIndex < nextRound.matches.length) {
        const nextMatch = nextRound.matches[nextMatchIndex];
        
        // Clear the participant
        if (isPlayer1Position) {
          nextMatch.p1 = { name: '승자', isPlaceholder: true } as any;
        } else {
          nextMatch.p2 = { name: '승자', isPlaceholder: true } as any;
        }
        
        // Clear the winner of this next match
        nextMatch.winnerId = undefined;
        nextMatch.winner = undefined;
        nextMatch.result = undefined;
        
        // Move to the next round to continue clearing
        r++;
        mIdx = nextMatchIndex;
      } else {
        break;
      }
    }

    setBrackets(prev => ({ ...prev, [key]: newBracket }));
  };

  const resetTournament = () => {
    const newParticipants = generateParticipants();
    setParticipants(newParticipants);
    localStorage.setItem('participants', JSON.stringify(newParticipants));
    setBrackets({});
    localStorage.removeItem('brackets');
    localStorage.removeItem('scannedAthleteIds');
    localStorage.removeItem('scannerLogs');
    localStorage.removeItem('weighInParticipants');
    localStorage.removeItem('appeals');
  };

  return (
    <TournamentContext.Provider value={{ 
      participants, 
      setParticipants, 
      brackets, 
      setBrackets,
      getBracket, 
      generateBracket, 
      updateMatchWinner,
      tournamentName,
      setTournamentName,
      updateMatchMode,
      resetTournament
    }}>
      {children}
    </TournamentContext.Provider>
  );
};

export const useTournament = () => {
  const context = useContext(TournamentContext);
  if (!context) throw new Error('useTournament must be used within a TournamentProvider');
  return context;
};
