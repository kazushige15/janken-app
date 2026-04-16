'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

// カードリスト定義（数値が見やすいように調整）
const WEAPONS = [
  { name: '木の手剣', damage: 10, icon: '🗡️' },
  { name: '鉄の剣', damage: 15, icon: '⚔️' },
  { name: '神の雷', damage: 25, icon: '⚡' },
];
const ARMORS = [
  { name: '木の蓋', defense: 5, icon: '🪵' },
  { name: '鉄の盾', defense: 12, icon: '🛡️' },
  { name: '守護の光', defense: 99, icon: '✨' },
];

const ALL_CARDS = [...WEAPONS, ...ARMORS];

export default function GodFieldLitePage() {
  const [myId] = useState(uuidv4());
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameData, setGameData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    const channel = supabase.channel(`game-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, 
      (payload) => setGameData(payload.new))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [gameId]);

  const drawCard = () => ALL_CARDS[Math.floor(Math.random() * ALL_CARDS.length)].name;

  const startMatching = async () => {
    setLoading(true);
    const getRandomHand = () => [...Array(5)].map(() => drawCard());
    const { data: waitingGame } = await supabase.from('games').select('*').eq('status', 'waiting').maybeSingle();

    if (waitingGame) {
      const { data } = await supabase.from('games').update({ 
        player_b_id: myId, 
        player_b_hand: getRandomHand(),
        status: 'attacking',
        attacker_id: waitingGame.player_a_id,
        defender_id: myId
      }).eq('id', waitingGame.id).select().single();
      setGameId(data.id);
    } else {
      const { data } = await supabase.from('games').insert([{ 
        player_a_id: myId, 
        player_a_hand: getRandomHand(),
        status: 'waiting' 
      }]).select().single();
      setGameId(data.id);
    }
    setLoading(false);
  };

  const attack = async (cardName: string) => {
    const isPlayerA = gameData.player_a_id === myId;
    let hand = isPlayerA ? [...gameData.player_a_hand] : [...gameData.player_b_hand];
    const cardIndex = hand.indexOf(cardName);
    if (cardIndex > -1) hand.splice(cardIndex, 1);
    hand.push(drawCard());

    await supabase.from('games').update({
      [isPlayerA ? 'player_a_hand' : 'player_b_hand']: hand,
      selected_card: cardName,
      status: 'defending'
    }).eq('id', gameId);
  };

  const defend = async (armorName: string | null) => {
    const weapon = WEAPONS.find(w => w.name === gameData.selected_card);
    const armor = ARMORS.find(a => a.name === armorName);
    const damage = Math.max(0, (weapon?.damage || 0) - (armor?.defense || 0));

    const isPlayerA = gameData.player_a_id === myId;
    let nextHp = (isPlayerA ? gameData.player_a_hp : gameData.player_b_hp) - damage;
    let hand = isPlayerA ? [...gameData.player_a_hand] : [...gameData.player_b_hand];

    if (armorName) {
      const cardIndex = hand.indexOf(armorName);
      if (cardIndex > -1) hand.splice(cardIndex, 1);
      hand.push(drawCard());
    }

    const nextAttacker = gameData.defender_id;
    const nextDefender = gameData.attacker_id;

    await supabase.from('games').update({
      [isPlayerA ? 'player_a_hp' : 'player_b_hp']: Math.max(0, nextHp),
      [isPlayerA ? 'player_a_hand' : 'player_b_hand']: hand,
      attacker_id: nextAttacker,
      defender_id: nextDefender,
      selected_card: null,
      status: nextHp <= 0 ? 'finished' : 'attacking'
    }).eq('id', gameId);
  };

  if (!gameId) return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black text-white p-4 text-center">
      <h1 className="text-6xl font-black mb-12 italic text-yellow-500 tracking-tighter">GOD FIELD LITE</h1>
      <button onClick={startMatching} disabled={loading} className="border-4 border-yellow-500 px-12 py-6 text-3xl font-bold hover:bg-yellow-500 hover:text-black transition-all">
        {loading ? 'SEARCHING...' : 'ENTER ARENA'}
      </button>
    </main>
  );

  const isAttacker = gameData?.attacker_id === myId;
  const isMyTurn = (gameData?.status === 'attacking' && isAttacker) || (gameData?.status === 'defending' && !isAttacker);
  const myHand = gameData?.player_a_id === myId ? gameData?.player_a_hand : gameData?.player_b_hand;
  const myHp = gameData?.player_a_id === myId ? gameData?.player_a_hp : gameData?.player_b_hp;
  const opponentHp = gameData?.player_a_id === myId ? gameData?.player_b_hp : gameData?.player_a_hp;

  return (
    <main className="flex min-h-screen flex-col items-center justify-between bg-zinc-950 text-white p-6">
      {/* 相手HP */}
      <div className="w-full max-w-md">
        <div className="flex justify-between items-end mb-1">
          <span className="text-xs font-bold text-zinc-500 tracking-widest uppercase">Enemy Predictor</span>
          <span className="text-2xl font-black text-red-500">HP {opponentHp}</span>
        </div>
        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden border border-zinc-700">
          <div className="h-full bg-red-600 transition-all duration-500 shadow-[0_0_10px_rgba(220,38,38,0.5)]" style={{ width: `${(opponentHp / 50) * 100}%` }}></div>
        </div>
      </div>

      {/* バトルメッセージ */}
      <div className="text-center w-full bg-zinc-900/50 py-8 rounded-3xl border border-zinc-800">
        <h2 className="text-3xl font-black mb-2 italic">
            {gameData?.status === 'defending' ? (
                <span className="text-orange-500">[{gameData.selected_card}] が襲来！</span>
            ) : (
                <span className="text-zinc-400">TURN PHASE</span>
            )}
        </h2>
        <p className={`text-xl font-mono ${isMyTurn ? 'text-yellow-400 animate-pulse' : 'text-zinc-600'}`}>
            {isMyTurn ? ">>> SELECT YOUR MOVE <<<" : "OPPONENT THINKING..."}
        </p>
      </div>

      {/* 自分の手札とHP */}
      <div className="w-full max-w-xl">
        <div className="flex flex-wrap gap-3 justify-center mb-8">
          {myHand?.map((cardName: string, i: number) => {
            const cardInfo = ALL_CARDS.find(c => c.name === cardName);
            const isWeapon = WEAPONS.some(w => w.name === cardName);
            
            return (
              <button 
                key={i} 
                onClick={() => gameData.status === 'attacking' ? attack(cardName) : defend(cardName)}
                disabled={!isMyTurn || (gameData.status === 'defending' && isWeapon)}
                className={`w-24 h-36 rounded-xl border-2 flex flex-col items-center justify-between p-2 transition-all shadow-xl ${
                    isMyTurn 
                    ? 'border-yellow-500 bg-zinc-800 hover:-translate-y-4 hover:shadow-yellow-500/20' 
                    : 'border-zinc-800 bg-zinc-900 opacity-30 cursor-not-allowed'
                }`}
              >
                <span className="text-4xl mt-2">{cardInfo?.icon}</span>
                <div className="text-center">
                    <p className="text-[10px] font-black leading-tight mb-1">{cardName}</p>
                    {/* 数値の表示を強化！ */}
                    <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isWeapon ? 'bg-red-900/50 text-red-400' : 'bg-blue-900/50 text-blue-400'}`}>
                        {isWeapon ? `ATK: ${(cardInfo as any).damage}` : `DEF: ${(cardInfo as any).defense}`}
                    </div>
                </div>
              </button>
            )
          })}
          {gameData?.status === 'defending' && !isAttacker && (
            <button onClick={() => defend(null)} className="w-24 h-36 rounded-xl border-4 border-red-600 bg-red-600/10 font-black text-sm hover:bg-red-600 hover:text-white transition-all">
              直撃<br/>を受ける
            </button>
          )}
        </div>

        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden border border-zinc-700 mb-1">
          <div className="h-full bg-blue-600 transition-all duration-500 shadow-[0_0_10px_rgba(37,99,235,0.5)]" style={{ width: `${(myHp / 50) * 100}%` }}></div>
        </div>
        <div className="flex justify-between items-start">
          <span className="text-2xl font-black text-blue-500 italic">HP {myHp}</span>
          <span className="text-xs font-bold text-zinc-500 tracking-widest uppercase">Your Prophet</span>
        </div>
      </div>
    </main>
  );
}