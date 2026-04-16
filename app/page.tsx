'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

// --- カードデータ定義 ---
const WEAPONS = [
  { name: '木の手剣', value: 10, icon: '🗡️', type: 'weapon' },
  { name: '鉄の剣', value: 15, icon: '⚔️', type: 'weapon' },
  { name: '長槍', value: 20, icon: '🔱', type: 'weapon' },
  { name: '神の雷', value: 30, icon: '⚡', type: 'weapon' },
];
const ARMORS = [
  { name: '木の蓋', value: 5, icon: '🪵', type: 'armor' },
  { name: '鉄の盾', value: 12, icon: '🛡️', type: 'armor' },
  { name: '大盾', value: 25, icon: '🏯', type: 'armor' },
];
const HEALS = [
  { name: '薬草', value: 10, icon: '🌿', type: 'heal' },
];
const ALL_CARDS = [...WEAPONS, ...ARMORS, ...HEALS];

export default function GodFieldPage() {
  const [myId] = useState(uuidv4());
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameData, setGameData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedArmorIndices, setSelectedArmorIndices] = useState<number[]>([]);

  useEffect(() => {
    if (!gameId) return;
    const channel = supabase.channel(`game-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, 
      (payload) => {
        setGameData(payload.new);
        setSelectedArmorIndices([]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [gameId]);

  const drawCard = () => ALL_CARDS[Math.floor(Math.random() * ALL_CARDS.length)].name;
  const generateHand = () => [...Array(10)].map(() => drawCard());

  const startMatching = async () => {
    setLoading(true);
    const { data: waitingGame } = await supabase.from('games').select('*').eq('status', 'waiting').maybeSingle();

    if (waitingGame) {
      const { data } = await supabase.from('games').update({ 
        player_b_id: myId, 
        player_b_hand: generateHand(),
        status: 'attacking',
        attacker_id: waitingGame.player_a_id,
        defender_id: myId
      }).eq('id', waitingGame.id).select().single();
      if (data) { setGameId(data.id); setGameData(data); }
    } else {
      const { data } = await supabase.from('games').insert([{ 
        player_a_id: myId, 
        player_a_hand: generateHand(),
        status: 'waiting' 
      }]).select().single();
      if (data) { setGameId(data.id); setGameData(data); }
    }
    setLoading(false);
  };

  const useCard = async (cardName: string, index: number) => {
    if (gameData?.status !== 'attacking' || gameData.attacker_id !== myId) return;
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
    if (gameData?.status !== 'defending' || gameData.defender_id !== myId) return;
    const isPlayerA = gameData.player_a_id === myId;
    let hand = isPlayerA ? [...(gameData.player_a_hand || [])] : [...(gameData.player_b_hand || [])];
    let totalDefense = 0;

    if (!hit) {
      const indicesToRemove = [...selectedArmorIndices].sort((a, b) => b - a);
      indicesToRemove.forEach(idx => {
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
      <h1 className="text-7xl font-black mb-12 italic text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 to-yellow-600 tracking-tighter filter drop-shadow-lg">GOD FIELD</h1>
      <button onClick={startMatching} disabled={loading} className="group relative px-12 py-6 bg-transparent border-2 border-yellow-500 text-yellow-500 text-3xl font-black italic hover:bg-yellow-500 hover:text-black transition-all duration-300 shadow-[0_0_20px_rgba(234,179,8,0.2)]">
        <span className="relative z-10">{loading ? 'MATCHING...' : 'ENTER ARENA'}</span>
      </button>
    </main>
  );

  const isAttacker = gameData.attacker_id === myId;
  const isDefender = gameData.defender_id === myId;
  const isMyTurn = (gameData.status === 'attacking' && isAttacker) || (gameData.status === 'defending' && isDefender);
  const myHand = gameData.player_a_id === myId ? gameData.player_a_hand : gameData.player_b_hand;
  const myHp = gameData.player_a_id === myId ? gameData.player_a_hp : gameData.player_b_hp;
  const opponentHp = gameData.player_a_id === myId ? gameData.player_b_hp : gameData.player_a_hp;

  return (
    <main className="flex min-h-screen flex-col items-center justify-between bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900 via-black to-black text-white p-4 overflow-hidden">
      {/* ENEMY SECTION */}
      <div className="w-full max-w-md mt-4">
        <div className="flex justify-between items-end mb-2 px-1">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Enemy Prophet</span>
          <span className="text-2xl font-black text-red-500 italic drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]">HP {opponentHp}</span>
        </div>
        <div className="h-2 bg-zinc-900 rounded-full border border-white/5 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-red-800 to-red-500 transition-all duration-700" style={{ width: `${(opponentHp / 50) * 100}%` }}></div>
        </div>
      </div>

      {/* CENTER MESSAGE */}
      <div className="text-center w-full max-w-xl py-10 px-4 rounded-[3rem] bg-white/[0.02] border border-white/5 backdrop-blur-md shadow-2xl relative">
        <div className="absolute inset-0 bg-yellow-500/5 blur-3xl rounded-full pointer-events-none"></div>
        {gameData.status === 'finished' ? (
          <div className="relative z-10">
            <h2 className="text-6xl font-black text-yellow-500 italic mb-6 tracking-tighter">{myHp > 0 ? 'VICTORY' : 'DEFEATED'}</h2>
            <button onClick={() => window.location.reload()} className="px-12 py-3 bg-yellow-500 text-black font-black rounded-full hover:scale-110 transition-transform shadow-xl">RETRY</button>
          </div>
        ) : (
          <div className="relative z-10">
            <h2 className="text-3xl font-black italic text-zinc-100 tracking-tight">
                {gameData.status === 'defending' ? `💥 [${gameData.selected_card}] が飛来！` : 'BATTLE PHASE'}
            </h2>
            <p className={`text-xs font-black mt-2 tracking-[0.3em] uppercase ${isMyTurn ? 'text-yellow-400 animate-pulse' : 'text-zinc-600'}`}>
                {isMyTurn ? ">>> YOUR TURN <<<" : "OPPONENT THINKING..."}
            </p>
            {gameData.status === 'defending' && isDefender && (
                <div className="mt-8 flex gap-4 justify-center">
                    <button onClick={() => executeDefense(false)} className="px-8 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-black text-xs transition-all shadow-lg shadow-cyan-900/40">防御実行</button>
                    <button onClick={() => executeDefense(true)} className="px-8 py-3 bg-zinc-800 hover:bg-red-900 rounded-xl font-black text-xs transition-all">直撃を受ける</button>
                </div>
            )}
          </div>
        )}
      </div>

      {/* HAND SECTION */}
      <div className="w-full max-w-4xl pb-4">
        <div className="grid grid-cols-5 gap-3 sm:gap-4 justify-items-center mb-8">
          {myHand?.map((cardName: string, i: number) => {
            const cardInfo = ALL_CARDS.find(c => c.name === cardName);
            const isSelected = selectedArmorIndices.includes(i);
            let canClick = isMyTurn && gameData.status !== 'finished' && 
                           ((gameData.status === 'attacking' && cardInfo?.type !== 'armor') || 
                            (gameData.status === 'defending' && cardInfo?.type === 'armor'));

            return (
              <button key={i} 
                onClick={() => {
                  if (gameData.status === 'attacking') useCard(cardName, i);
                  else if (gameData.status === 'defending') setSelectedArmorIndices(prev => prev.includes(i) ? prev.filter(idx => idx !== i) : [...prev, i]);
                }}
                disabled={!canClick}
                className={`relative w-full aspect-[2/3] max-w-[90px] rounded-2xl border-2 flex flex-col items-center justify-between p-1 transition-all duration-300 ${
                  isSelected ? 'border-cyan-400 bg-cyan-900/40 -translate-y-6 scale-110 shadow-[0_0_25px_rgba(34,211,238,0.4)]' :
                  canClick ? 'border-zinc-600 bg-gradient-to-b from-zinc-800 to-zinc-950 hover:border-yellow-500 hover:shadow-[0_0_15px_rgba(250,204,21,0.2)]' : 
                  'border-zinc-900 bg-black opacity-10 scale-95'
                }`}
              >
                {canClick && <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent pointer-events-none" />}
                <span className="text-3xl mt-3 drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">{cardInfo?.icon}</span>
                <div className="w-full bg-black/40 backdrop-blur-md rounded-b-xl py-1.5 px-0.5 text-center">
                  <p className="text-[7px] font-black uppercase tracking-tighter text-zinc-200 mb-1 truncate">{cardName}</p>
                  <div className={`text-[8px] font-black py-0.5 rounded-md ${
                    cardInfo?.type === 'weapon' ? 'bg-red-600/20 text-red-400' : 
                    cardInfo?.type === 'heal' ? 'bg-emerald-600/20 text-emerald-400' : 'bg-cyan-600/20 text-cyan-400'
                  }`}>
                    {cardInfo?.value}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* PLAYER HP */}
        <div className="max-w-md mx-auto px-1">
            <div className="h-2.5 bg-zinc-900 rounded-full border border-white/5 overflow-hidden mb-2">
              <div className="h-full bg-gradient-to-r from-cyan-800 to-cyan-500 transition-all duration-700 shadow-[0_0_15px_rgba(6,182,212,0.4)]" style={{ width: `${(myHp / 50) * 100}%` }}></div>
            </div>
            <div className="flex justify-between items-center text-[10px] font-black italic text-cyan-500 tracking-[0.2em] uppercase">
                <span>Your Prophet</span>
                <span className="text-2xl drop-shadow-[0_0_10px_rgba(6,182,212,0.5)]">HP {myHp} / 50</span>
            </div>
        </div>
      </div>
    </main>
  );
}