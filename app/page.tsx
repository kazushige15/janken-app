'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

// --- カードデータ定義 ---
const WEAPONS = [
  { name: '精霊の剣', value: 30, icon: '/剣_transparent.png', type: 'weapon' },
  { name: '光の聖剣', value: 25, icon: '/剣_transparent.png', type: 'weapon' },
  { name: '鉄の剣', value: 15, icon: '/剣_transparent.png', type: 'weapon' },
  { name: '錆びた剣', value: 10, icon: '/剣_transparent.png', type: 'weapon' },
];
const ARMORS = [
  { name: '大盾', value: 25, icon: '🏯', type: 'armor' },
  { name: '鉄の盾', value: 12, icon: '🛡️', type: 'armor' },
  { name: '木の蓋', value: 5, icon: '🪵', type: 'armor' },
];
const HEALS = [
  { name: '薬草', value: 10, icon: '🌿', type: 'heal' },
];
const ALL_CARDS = [...WEAPONS, ...ARMORS, ...HEALS];

export default function GodFieldPage() {
  const [myId] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('godfield_user_id');
      if (saved) return saved;
      const newId = uuidv4();
      localStorage.setItem('godfield_user_id', newId);
      return newId;
    }
    return uuidv4();
  });

  const [gameId, setGameId] = useState<string | null>(null);
  const [gameData, setGameData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedArmorIndices, setSelectedArmorIndices] = useState<number[]>([]);

  // リアルタイム通信
  useEffect(() => {
    if (!gameId) return;
    const channel = supabase.channel(`game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, 
      (payload) => {
        setGameData(payload.new);
        setSelectedArmorIndices([]); 
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [gameId]);

  const drawCard = () => ALL_CARDS[Math.floor(Math.random() * ALL_CARDS.length)].name;
  const generateHand = () => [...Array(10)].map(() => drawCard());

  // マッチングロジック：空いている部屋を探す or なければ作る
  const startMatching = async () => {
    setLoading(true);

    // 1. まず「誰か1人だけが待っている（player_bが不在）」かつ「自分ではない」部屋を探す
    const { data: openRoom } = await supabase
      .from('games')
      .select('*')
      .eq('status', 'waiting')
      .is('player_b_id', null)
      .neq('player_a_id', myId)
      .maybeSingle();

    if (openRoom) {
      // 2. 空いている部屋があったらそこに入る（マッチング成立）
      const { data, error } = await supabase
        .from('games')
        .update({ 
          player_b_id: myId, 
          player_b_hand: generateHand(),
          status: 'attacking',
          attacker_id: openRoom.player_a_id,
          defender_id: myId
        })
        .eq('id', openRoom.id)
        .select()
        .single();
      
      if (data) { setGameId(data.id); setGameData(data); }
    } else {
      // 3. 空いている部屋がなければ、新しく自分がホストとなって部屋を作る
      const { data } = await supabase
        .from('games')
        .insert([{ 
          player_a_id: myId, 
          player_a_hand: generateHand(),
          player_a_hp: 50,
          player_b_hp: 50,
          status: 'waiting' 
        }])
        .select()
        .single();
      if (data) { setGameId(data.id); setGameData(data); }
    }
    setLoading(false);
  };

  // --- カード使用・防御のロジックは変更なし ---
  const useCard = async (cardName: string, index: number) => {
    if (!gameData || gameData.attacker_id !== myId) return;
    const isPlayerA = gameData.player_a_id === myId;
    const card = ALL_CARDS.find(c => c.name === cardName);
    let hand = isPlayerA ? [...(gameData.player_a_hand || [])] : [...(gameData.player_b_hand || [])];
    hand.splice(index, 1);
    hand.push(drawCard());

    if (card?.type === 'heal') {
      const currentHp = isPlayerA ? gameData.player_a_hp : gameData.player_b_hp;
      await supabase.from('games').update({
        [isPlayerA ? 'player_a_hp' : 'player_b_hp']: Math.min(50, currentHp + (card.value || 0)),
        [isPlayerA ? 'player_a_hand' : 'player_b_hand']: hand,
        attacker_id: gameData.defender_id,
        defender_id: gameData.attacker_id,
        status: 'attacking'
      }).eq('id', gameId);
    } else if (card?.type === 'weapon') {
      await supabase.from('games').update({
        [isPlayerA ? 'player_a_hand' : 'player_b_hand']: hand,
        selected_card: cardName,
        status: 'defending'
      }).eq('id', gameId);
    }
  };

  const executeDefense = async (hit: boolean) => {
    if (!gameData || gameData.defender_id !== myId) return;
    const isPlayerA = gameData.player_a_id === myId;
    let hand = isPlayerA ? [...(gameData.player_a_hand || [])] : [...(gameData.player_b_hand || [])];
    let totalDefense = 0;

    if (!hit) {
      const sortedIndices = [...selectedArmorIndices].sort((a, b) => b - a);
      sortedIndices.forEach(idx => {
        const cardInfo = ALL_CARDS.find(c => c.name === hand[idx]);
        totalDefense += cardInfo?.value || 0;
        hand.splice(idx, 1);
        hand.push(drawCard());
      });
    }

    const weapon = WEAPONS.find(w => w.name === gameData.selected_card);
    const damage = Math.max(0, (weapon?.value || 0) - totalDefense);
    const nextHp = Math.max(0, (isPlayerA ? gameData.player_a_hp : gameData.player_b_hp) - damage);

    await supabase.from('games').update({
      [isPlayerA ? 'player_a_hp' : 'player_b_hp']: nextHp,
      [isPlayerA ? 'player_a_hand' : 'player_b_hand']: hand,
      attacker_id: nextHp <= 0 ? null : gameData.defender_id,
      defender_id: nextHp <= 0 ? null : gameData.attacker_id,
      selected_card: null,
      status: nextHp <= 0 ? 'finished' : 'attacking'
    }).eq('id', gameId);
  };

  if (!gameId || !gameData) return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-white p-4">
      <h1 className="text-7xl font-black mb-12 italic text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 to-yellow-600 tracking-tighter filter drop-shadow-lg text-center leading-tight">GOD FIELD</h1>
      <button onClick={startMatching} disabled={loading} className="px-12 py-6 border-2 border-yellow-500 text-yellow-500 text-3xl font-black hover:bg-yellow-500 hover:text-black transition-all">
        {loading ? 'WAITING...' : 'ENTER ARENA'}
      </button>
      <p className="mt-8 text-[10px] text-zinc-600 tracking-widest uppercase">Room-based Auto Matching System v2</p>
    </main>
  );

  const isAttacker = gameData.attacker_id === myId;
  const isDefender = gameData.defender_id === myId;
  const isMyTurn = (gameData.status === 'attacking' && isAttacker) || (gameData.status === 'defending' && isDefender);
  const myHand = gameData.player_a_id === myId ? gameData.player_a_hand : gameData.player_b_hand;
  const myHp = gameData.player_a_id === myId ? gameData.player_a_hp : gameData.player_b_hp;
  const opponentHp = gameData.player_a_id === myId ? gameData.player_b_hp : gameData.player_a_hp;

  return (
    <main className="flex min-h-screen flex-col items-center justify-between bg-zinc-950 text-white p-4 font-sans select-none">
      <div className="w-full max-w-md mt-2">
        <div className="flex justify-between items-end mb-1 px-1 text-red-500 italic font-black">
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">Enemy Prophet</span>
          <span className="text-2xl">HP {opponentHp}</span>
        </div>
        <div className="h-2 bg-zinc-900 rounded-full border border-white/5 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-red-900 to-red-500 transition-all duration-700" style={{ width: `${(opponentHp / 50) * 100}%` }}></div>
        </div>
      </div>

      <div className="text-center w-full max-w-xl py-12 px-4 rounded-[3rem] bg-white/[0.02] border border-white/5 backdrop-blur-md shadow-2xl relative">
        {gameData.status === 'finished' ? (
          <div>
            <h2 className="text-6xl font-black text-yellow-500 italic mb-6 tracking-tighter">{myHp > 0 ? 'VICTORY' : 'DEFEATED'}</h2>
            <button onClick={() => window.location.reload()} className="px-12 py-3 bg-yellow-500 text-black font-black rounded-full shadow-lg">TITLE</button>
          </div>
        ) : (
          <div>
            <h2 className="text-3xl font-black italic text-zinc-100 mb-2 tracking-tight">
                {gameData.status === 'defending' ? `💥 [${gameData.selected_card}] が飛来！` : 'BATTLE PHASE'}
            </h2>
            <p className={`text-[11px] font-black tracking-[0.4em] uppercase ${isMyTurn ? 'text-yellow-400 animate-pulse' : 'text-zinc-600'}`}>
                {isMyTurn ? ">>> YOUR TURN <<<" : "OPPONENT THINKING..."}
            </p>
            {gameData.status === 'defending' && isDefender && (
                <div className="mt-8 flex gap-4 justify-center">
                    <button onClick={() => executeDefense(false)} className="px-10 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-black text-xs transition-all shadow-lg">防御実行</button>
                    <button onClick={() => executeDefense(true)} className="px-10 py-3 bg-zinc-800 hover:bg-red-900 rounded-xl font-black text-xs transition-all">直撃を受ける</button>
                </div>
            )}
          </div>
        )}
      </div>

      <div className="w-full max-w-4xl pb-4">
        <div className="grid grid-cols-5 gap-3 justify-items-center mb-10 px-2">
          {myHand?.map((cardName: string, i: number) => {
            const cardInfo = ALL_CARDS.find(c => c.name === cardName);
            const isSelected = selectedArmorIndices.includes(i);
            const isArmor = cardInfo?.type === 'armor';
            let canClick = isMyTurn && gameData.status !== 'finished' && ((gameData.status === 'attacking' && !isArmor) || (gameData.status === 'defending' && isArmor));

            return (
              <button key={i} 
                onClick={() => {
                  if (gameData.status === 'attacking') useCard(cardName, i);
                  else if (gameData.status === 'defending') setSelectedArmorIndices(prev => prev.includes(i) ? prev.filter(idx => idx !== i) : [...prev, i]);
                }}
                disabled={!canClick}
                className={`relative w-full aspect-[2/3] max-w-[95px] rounded-2xl border-2 flex flex-col items-center justify-between p-1 transition-all duration-300 ${
                  isSelected ? 'border-cyan-400 bg-cyan-900/40 -translate-y-8 scale-110 shadow-[0_0_25px_rgba(34,211,238,0.5)]' :
                  canClick ? 'border-zinc-500 bg-gradient-to-b from-zinc-800 to-zinc-950 hover:border-yellow-500 shadow-xl' : 
                  'border-zinc-900 bg-black opacity-20 scale-95 grayscale'
                }`}
              >
                {cardInfo?.type === 'weapon' && cardInfo.icon.endsWith('.png') ? (
                  <img src={cardInfo.icon} className="w-[85%] aspect-square object-contain mt-3 drop-shadow-lg" alt="" />
                ) : (
                  <span className="text-3xl mt-4 drop-shadow-md">{cardInfo?.icon}</span>
                )}
                <div className="w-full bg-black/60 backdrop-blur-md rounded-b-xl py-2 px-0.5 text-center mt-auto">
                  <p className="text-[7.5px] font-black uppercase tracking-tighter text-zinc-100 mb-1 truncate">{cardName}</p>
                  <div className={`text-[9px] font-black py-0.5 rounded-md ${
                    cardInfo?.type === 'weapon' ? 'bg-red-600/30 text-red-400' : 
                    cardInfo?.type === 'heal' ? 'bg-green-600/30 text-green-400' : 'bg-blue-600/30 text-blue-400'
                  }`}>
                    {cardInfo?.value}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="max-w-md mx-auto px-1">
            <div className="h-2.5 bg-zinc-900 rounded-full border border-white/5 overflow-hidden mb-2">
              <div className="h-full bg-gradient-to-r from-blue-800 to-blue-500 transition-all duration-700 shadow-[0_0_15px_rgba(37,99,235,0.3)]" style={{ width: `${(myHp / 50) * 100}%` }}></div>
            </div>
            <div className="flex justify-between items-center text-blue-500 italic font-black uppercase tracking-[0.2em]">
                <span className="text-[10px] text-zinc-500">Your Prophet</span>
                <span className="text-2xl">HP {myHp} / 50</span>
            </div>
        </div>
      </div>
    </main>
  );
}