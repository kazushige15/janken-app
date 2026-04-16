'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

// カードの定義
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

export default function GodFieldLitePage() {
  const [myId] = useState(uuidv4());
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameData, setGameData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // 1. リアルタイム監視
  useEffect(() => {
    if (!gameId) return;
    const channel = supabase.channel(`game-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, 
      (payload) => setGameData(payload.new))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [gameId]);

  // 2. マッチング & 初期手札配布
  const startMatching = async () => {
    setLoading(true);
    const getRandomHand = () => [...Array(5)].map(() => {
      const all = [...WEAPONS, ...ARMORS];
      return all[Math.floor(Math.random() * all.length)].name;
    });

    const { data: waitingGame } = await supabase.from('games').select('*').eq('status', 'waiting').maybeSingle();

    if (waitingGame) {
      const { data } = await supabase.from('games').update({ 
        player_b_id: myId, 
        player_b_hand: getRandomHand(),
        status: 'attacking',
        attacker_id: waitingGame.player_a_id, // Aが先攻
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

  // 3. 攻撃側：カード選択
  const attack = async (cardName: string) => {
    const isPlayerA = gameData.player_a_id === myId;
    const newHand = (isPlayerA ? gameData.player_a_hand : gameData.player_b_hand).filter((c: string, i: number, self: any) => i !== self.indexOf(cardName));
    
    await supabase.from('games').update({
      [isPlayerA ? 'player_a_hand' : 'player_b_hand']: newHand,
      selected_card: cardName,
      status: 'defending'
    }).eq('id', gameId);
  };

  // 4. 防御側：カード選択 or 受ける
  const defend = async (armorName: string | null) => {
    const weapon = WEAPONS.find(w => w.name === gameData.selected_card);
    const armor = ARMORS.find(a => a.name === armorName);
    const damage = Math.max(0, (weapon?.damage || 0) - (armor?.defense || 0));

    const isPlayerA = gameData.player_a_id === myId;
    let nextHp = (isPlayerA ? gameData.player_a_hp : gameData.player_b_hp) - damage;
    
    // 防具を消費
    let newHand = isPlayerA ? gameData.player_a_hand : gameData.player_b_hand;
    if (armorName) {
        newHand = newHand.filter((c: string, i: number, self: any) => i !== self.indexOf(armorName));
    }

    // 攻守交代の準備
    const nextAttacker = gameData.defender_id;
    const nextDefender = gameData.attacker_id;

    await supabase.from('games').update({
      [isPlayerA ? 'player_a_hp' : 'player_b_hp']: Math.max(0, nextHp),
      [isPlayerA ? 'player_a_hand' : 'player_b_hand']: newHand,
      attacker_id: nextAttacker,
      defender_id: nextDefender,
      selected_card: null,
      status: nextHp <= 0 ? 'finished' : 'attacking'
    }).eq('id', gameId);
  };

  if (!gameId) return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-white">
      <h1 className="text-5xl font-black mb-8 text-yellow-500">GOD FIELD LITE</h1>
      <button onClick={startMatching} className="border-2 border-yellow-500 px-8 py-4 text-xl hover:bg-yellow-500/20">ARENA ENTER</button>
    </main>
  );

  const isAttacker = gameData?.attacker_id === myId;
  const isMyTurn = (gameData?.status === 'attacking' && isAttacker) || (gameData?.status === 'defending' && !isAttacker);
  const myHand = gameData?.player_a_id === myId ? gameData?.player_a_hand : gameData?.player_b_hand;
  const myHp = gameData?.player_a_id === myId ? gameData?.player_a_hp : gameData?.player_b_hp;
  const opponentHp = gameData?.player_a_id === myId ? gameData?.player_b_hp : gameData?.player_a_hp;

  return (
    <main className="flex min-h-screen flex-col items-center justify-between bg-zinc-900 text-white p-4">
      {/* 相手情報 */}
      <div className="text-center w-full max-w-sm">
        <p className="text-red-500 font-bold">ENEMY HP: {opponentHp}</p>
        <div className="h-2 bg-zinc-700 w-full rounded-full"><div className="h-full bg-red-500 transition-all" style={{width:`${opponentHp*2}%`}}></div></div>
      </div>

      {/* 中央：バトル状況 */}
      <div className="text-center py-10 bg-black/40 w-full rounded-3xl border border-white/10">
        <h2 className="text-2xl font-bold mb-4">
            {gameData?.status === 'defending' ? `🔥 ${gameData.selected_card} が飛んできた！` : '⚔️ 攻守交代'}
        </h2>
        <p className="text-zinc-400">{isMyTurn ? "あなたの番です" : "相手の行動を待っています..."}</p>
      </div>

      {/* 自分情報 & 手札 */}
      <div className="w-full max-w-lg">
        <p className="text-blue-400 font-bold mb-2">YOUR HP: {myHp}</p>
        <div className="flex flex-wrap gap-2 justify-center mb-8">
          {myHand?.map((cardName: string, i: number) => {
            const isWeapon = WEAPONS.some(w => w.name === cardName);
            return (
              <button 
                key={i} 
                onClick={() => gameData.status === 'attacking' ? attack(cardName) : defend(cardName)}
                disabled={!isMyTurn || (gameData.status === 'defending' && isWeapon)}
                className={`w-20 h-28 rounded-lg border-2 flex flex-col items-center justify-center p-1 text-xs font-bold transition-all ${isMyTurn ? 'border-yellow-400 bg-zinc-800 scale-105' : 'border-zinc-700 bg-zinc-900 opacity-50'}`}
              >
                <span className="text-2xl mb-1">{[...WEAPONS, ...ARMORS].find(c => c.name === cardName)?.icon}</span>
                {cardName}
              </button>
            )
          })}
          {gameData?.status === 'defending' && !isAttacker && (
            <button onClick={() => defend(null)} className="w-20 h-28 rounded-lg border-2 border-red-500 bg-red-900/20 font-bold">直撃を受ける</button>
          )}
        </div>
      </div>
    </main>
  );
}