'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

// --- カードデータ定義（調整済み） ---
const WEAPONS = [
  { name: '木の手剣', value: 10, icon: '🗡️', type: 'weapon' },
  { name: '鉄の剣', value: 15, icon: '⚔️', type: 'weapon' },
  { name: '長槍', value: 20, icon: '🔱', type: 'weapon' },
  { name: '神の雷', value: 30, icon: '⚡', type: 'weapon' },
];
const ARMORS = [
  { name: '木の蓋', value: 5, icon: '🪵', type: 'armor' },
  { name: '鉄の盾', value: 12, icon: '🛡️', type: 'armor' },
  { name: '大盾', value: 25, icon: '🏯', type: 'armor' }, // 99を消して25に変更
];
const HEALS = [
  { name: '薬草', value: 10, icon: '🌿', type: 'heal' }, // 回復量を10に変更
];
const ALL_CARDS = [...WEAPONS, ...ARMORS, ...HEALS];

export default function BalancedGodFieldPage() {
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

  const startMatching = async () => {
    setLoading(true);
    const getRandomHand = () => [...Array(10)].map(() => drawCard());
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

  const useCard = async (cardName: string, index: number) => {
    if (gameData.status !== 'attacking') return;
    const isPlayerA = gameData.player_a_id === myId;
    const card = ALL_CARDS.find(c => c.name === cardName);
    let hand = isPlayerA ? [...gameData.player_a_hand] : [...gameData.player_b_hand];
    
    hand.splice(index, 1);
    hand.push(drawCard());

    if (card?.type === 'heal') {
      // 回復してターン終了（攻守交代）
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
    const isPlayerA = gameData.player_a_id === myId;
    let hand = isPlayerA ? [...gameData.player_a_hand] : [...gameData.player_b_hand];
    let totalDefense = 0;

    if (!hit) {
      const indicesToRemove = [...selectedArmorIndices].sort((a, b) => b - a);
      indicesToRemove.forEach(idx => {
        const cardName = hand[idx];
        const cardInfo = ARMORS.find(a => a.name === cardName);
        totalDefense += cardInfo?.value || 0;
        hand.splice(idx, 1);
        hand.push(drawCard());
      });
    }

    const weapon = WEAPONS.find(w => w.name === gameData.selected_card);
    const damage = Math.max(0, (weapon?.value || 0) - totalDefense);
    const currentHp = isPlayerA ? gameData.player_a_hp : gameData.player_b_hp;
    const nextHp = Math.max(0, currentHp - damage);

    await supabase.from('games').update({
      [isPlayerA ? 'player_a_hp' : 'player_b_hp']: nextHp,
      [isPlayerA ? 'player_a_hand' : 'player_b_hand']: hand,
      attacker_id: nextHp <= 0 ? null : gameData.defender_id,
      defender_id: nextHp <= 0 ? null : gameData.attacker_id,
      selected_card: null,
      status: nextHp <= 0 ? 'finished' : 'attacking'
    }).eq('id', gameId);
  };

  if (!gameId) return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black text-white p-4">
      <h1 className="text-6xl font-black mb-12 italic text-yellow-500 tracking-tighter">GOD FIELD</h1>
      <button onClick={startMatching} disabled={loading} className="border-4 border-yellow-500 px-12 py-6 text-3xl font-bold hover:bg-yellow-500 hover:text-black transition-all">
        {loading ? 'WAITING...' : 'ENTER ARENA'}
      </button>
    </main>
  );

  const isAttacker = gameData?.attacker_id === myId;
  const isMyTurn = (gameData?.status === 'attacking' && isAttacker) || (gameData?.status === 'defending' && !isAttacker);
  const myHand = gameData?.player_a_id === myId ? gameData?.player_a_hand : gameData?.player_b_hand;
  const myHp = gameData?.player_a_id === myId ? gameData?.player_a_hp : gameData?.player_b_hp;
  const opponentHp = gameData?.player_a_id === myId ? gameData?.player_b_hp : gameData?.player_a_hp;

  return (
    <main className="flex min-h-screen flex-col items-center justify-between bg-zinc-950 text-white p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-between items-end mb-1">
          <span className="text-[10px] font-bold text-zinc-600 uppercase">Enemy</span>
          <span className="text-xl font-black text-red-500 italic">HP {opponentHp}</span>
        </div>
        <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
          <div className="h-full bg-red-600 transition-all duration-500" style={{ width: `${(opponentHp / 50) * 100}%` }}></div>
        </div>
      </div>

      <div className="text-center w-full bg-zinc-900/30 py-6 rounded-3xl border border-white/5">
        {gameData?.status === 'finished' ? (
          <div>
            <h2 className="text-5xl font-black text-yellow-500 italic mb-4">{myHp > 0 ? 'VICTORY' : 'DEFEATED'}</h2>
            <button onClick={() => window.location.reload()} className="px-8 py-2 bg-yellow-500 text-black font-bold rounded-full">AGAIN</button>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-black italic text-zinc-300">
                {gameData?.status === 'defending' ? `💥 [${gameData.selected_card}] が飛来！` : 'YOUR TURN'}
            </h2>
            <p className={`text-xs font-mono mt-1 ${isMyTurn ? 'text-yellow-400' : 'text-zinc-600'}`}>
                {isMyTurn ? "行動を選択してください" : "相手のターンです"}
            </p>
            {gameData?.status === 'defending' && !isAttacker && (
                <div className="mt-4 flex gap-2 justify-center">
                    <button onClick={() => executeDefense(false)} className="px-4 py-2 bg-blue-600 rounded-lg font-bold text-[10px] hover:bg-blue-500">防御実行</button>
                    <button onClick={() => executeDefense(true)} className="px-4 py-2 bg-red-600 rounded-lg font-bold text-[10px] hover:bg-red-500">直撃を受ける</button>
                </div>
            )}
          </>
        )}
      </div>

      <div className="w-full max-w-4xl">
        <div className="grid grid-cols-5 gap-1.5 justify-items-center mb-4">
          {myHand?.map((cardName: string, i: number) => {
            const cardInfo = ALL_CARDS.find(c => c.name === cardName);
            const isWeapon = cardInfo?.type === 'weapon';
            const isArmor = cardInfo?.type === 'armor';
            const isHeal = cardInfo?.type === 'heal';
            const isSelected = selectedArmorIndices.includes(i);
            
            let canClick = isMyTurn;
            if (gameData?.status === 'attacking' && isArmor) canClick = false;
            if (gameData?.status === 'defending' && !isArmor) canClick = false;

            return (
              <button 
                key={i} 
                onClick={() => {
                    if (gameData.status === 'attacking') useCard(cardName, i);
                    else if (gameData.status === 'defending') {
                        setSelectedArmorIndices(prev => prev.includes(i) ? prev.filter(idx => idx !== i) : [...prev, i]);
                    }
                }}
                disabled={!canClick}
                className={`w-16 h-24 sm:w-20 sm:h-28 rounded border flex flex-col items-center justify-between p-1 transition-all ${
                    isSelected ? 'border-blue-400 bg-blue-900/40 -translate-y-2 scale-105' :
                    canClick ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-900 bg-zinc-950 opacity-20'
                }`}
              >
                <span className="text-xl mt-1">{cardInfo?.icon}</span>
                <div className="text-center">
                    <p className="text-[7px] font-bold leading-tight mb-1 truncate w-14">{cardName}</p>
                    <div className={`px-1 py-0.5 rounded-full text-[7px] font-bold ${
                        isWeapon ? 'bg-red-900 text-red-400' : 
                        isHeal ? 'bg-green-900 text-green-400' : 'bg-blue-900 text-blue-400'
                    }`}>
                        {isWeapon ? `ATK:${cardInfo?.value}` : isHeal ? `HEAL:${cardInfo?.value}` : `DEF:${cardInfo?.value}`}
                    </div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="max-w-md mx-auto">
            <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden mb-1">
              <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${(myHp / 50) * 100}%` }}></div>
            </div>
            <div className="flex justify-between items-center text-[10px] font-black italic text-blue-500">
                <span>PLAYER HP</span>
                <span className="text-lg">HP {myHp}</span>
            </div>
        </div>
      </div>
    </main>
  );
}