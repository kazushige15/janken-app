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

  // リアルタイム更新の監視
  useEffect(() => {
    if (!gameId) return;
    const channel = supabase.channel(`game-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, 
      (payload) => {
        setGameData(payload.new);
        setSelectedArmorIndices([]); // ターンが変わったら選択解除
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [gameId]);

  // カードを1枚引く
  const drawCard = () => ALL_CARDS[Math.floor(Math.random() * ALL_CARDS.length)].name;
  
  // 10枚の手札を生成
  const generateHand = () => [...Array(10)].map(() => drawCard());

  // マッチング開始
  const startMatching = async () => {
    setLoading(true);
    const { data: waitingGame } = await supabase.from('games').select('*').eq('status', 'waiting').maybeSingle();

    if (waitingGame) {
      // 相手がいる場合
      const { data, error } = await supabase.from('games').update({ 
        player_b_id: myId, 
        player_b_hand: generateHand(),
        status: 'attacking',
        attacker_id: waitingGame.player_a_id,
        defender_id: myId
      }).eq('id', waitingGame.id).select().single();
      if (data) { setGameId(data.id); setGameData(data); }
    } else {
      // 自分が待機する場合
      const { data, error } = await supabase.from('games').insert([{ 
        player_a_id: myId, 
        player_a_hand: generateHand(),
        status: 'waiting' 
      }]).select().single();
      if (data) { setGameId(data.id); setGameData(data); }
    }
    setLoading(false);
  };

  // カード使用（攻撃 or 回復）
  const useCard = async (cardName: string, index: number) => {
    if (gameData.status !== 'attacking') return;
    const isPlayerA = gameData.player_a_id === myId;
    const card = ALL_CARDS.find(c => c.name === cardName);
    let hand = isPlayerA ? [...(gameData.player_a_hand || [])] : [...(gameData.player_b_hand || [])];
    
    // 手札更新（使ったカードを抜いて新しく引く）
    hand.splice(index, 1);
    hand.push(drawCard());

    if (card?.type === 'heal') {
      // 【回復】HP+10してターン終了（攻守交代）
      const currentHp = isPlayerA ? gameData.player_a_hp : gameData.player_b_hp;
      await supabase.from('games').update({
        [isPlayerA ? 'player_a_hp' : 'player_b_hp']: Math.min(50, currentHp + (card.value || 0)),
        [isPlayerA ? 'player_a_hand' : 'player_b_hand']: hand,
        attacker_id: gameData.defender_id, // 攻守交代
        defender_id: gameData.attacker_id,
        status: 'attacking'
      }).eq('id', gameId);
    } else if (card?.type === 'weapon') {
      // 【攻撃】防御フェーズへ
      await supabase.from('games').update({
        [isPlayerA ? 'player_a_hand' : 'player_b_hand']: hand,
        selected_card: cardName,
        status: 'defending'
      }).eq('id', gameId);
    }
  };

  // 防御実行
  const executeDefense = async (hit: boolean) => {
    const isPlayerA = gameData.player_a_id === myId;
    let hand = isPlayerA ? [...(gameData.player_a_hand || [])] : [...(gameData.player_b_hand || [])];
    let totalDefense = 0;

    if (!hit) {
      // 選択した盾を消費して防御力を合算
      const indicesToRemove = [...selectedArmorIndices].sort((a, b) => b - a);
      indicesToRemove.forEach(idx => {
        const cardName = hand[idx];
        const cardInfo = ALL_CARDS.find(c => c.name === cardName);
        totalDefense += cardInfo?.value || 0;
        hand.splice(idx, 1);
        hand.push(drawCard());
      });
    }

    const weapon = WEAPONS.find(w => w.name === gameData.selected_card);
    const damage = Math.max(0, (weapon?.value || 0) - totalDefense);
    const currentHp = isPlayerA ? gameData.player_a_hp : gameData.player_b_hp;
    const nextHp = Math.max(0, currentHp - damage);

    // 更新して次のターンへ
    await supabase.from('games').update({
      [isPlayerA ? 'player_a_hp' : 'player_b_hp']: nextHp,
      [isPlayerA ? 'player_a_hand' : 'player_b_hand']: hand,
      attacker_id: nextHp <= 0 ? null : gameData.defender_id,
      defender_id: nextHp <= 0 ? null : gameData.attacker_id,
      selected_card: null,
      status: nextHp <= 0 ? 'finished' : 'attacking'
    }).eq('id', gameId);
  };

  // ローカル変数定義
  if (!gameId || !gameData) return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black text-white p-4">
      <h1 className="text-6xl font-black mb-12 italic text-yellow-500 tracking-tighter">GOD FIELD</h1>
      <button onClick={startMatching} disabled={loading} className="border-4 border-yellow-500 px-12 py-6 text-3xl font-bold hover:bg-yellow-500 hover:text-black transition-all">
        {loading ? 'WAITING...' : 'ENTER ARENA'}
      </button>
    </main>
  );

  const isAttacker = gameData.attacker_id === myId;
  const isMyTurn = (gameData.status === 'attacking' && isAttacker) || (gameData.status === 'defending' && !isAttacker);
  const myHand = gameData.player_a_id === myId ? gameData.player_a_hand : gameData.player_b_hand;
  const myHp = gameData.player_a_id === myId ? gameData.player_a_hp : gameData.player_b_hp;
  const opponentHp = gameData.player_a_id === myId ? gameData.player_b_hp : gameData.player_a_hp;

  return (
    <main className="flex min-h-screen flex-col items-center justify-between bg-zinc-950 text-white p-4">
      {/* 相手側情報 */}
      <div className="w-full max-w-md">
        <div className="flex justify-between items-end mb-1">
          <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Enemy Prophet</span>
          <span className="text-xl font-black text-red-500 italic">HP {opponentHp}</span>
        </div>
        <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
          <div className="h-full bg-red-600 transition-all duration-500" style={{ width: `${(opponentHp / 50) * 100}%` }}></div>
        </div>
      </div>

      {/* バトルメッセージ */}
      <div className="text-center w-full bg-zinc-900/40 py-8 rounded-3xl border border-white/5 shadow-2xl">
        {gameData.status === 'finished' ? (
          <div>
            <h2 className="text-5xl font-black text-yellow-500 italic mb-4">{myHp > 0 ? 'VICTORY' : 'DEFEATED'}</h2>
            <button onClick={() => window.location.reload()} className="px-10 py-3 bg-yellow-500 text-black font-black rounded-full hover:scale-110 transition-transform">BACK TO TITLE</button>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-black italic text-zinc-300">
                {gameData.status === 'defending' ? `💥 [${gameData.selected_card}] が飛来！` : 'TURN PHASE'}
            </h2>
            <p className={`text-xs font-mono mt-1 ${isMyTurn ? 'text-yellow-400 animate-pulse' : 'text-zinc-600'}`}>
                {isMyTurn ? ">>> YOUR ACTION <<<" : "OPPONENT THINKING..."}
            </p>
            {gameData.status === 'defending' && !isAttacker && (
                <div className="mt-4 flex gap-3 justify-center">
                    <button onClick={() => executeDefense(false)} className="px-6 py-2 bg-blue-600 rounded-lg font-black text-[10px] hover:bg-blue-500 shadow-lg shadow-blue-900/20">防御実行</button>
                    <button onClick={() => executeDefense(true)} className="px-6 py-2 bg-red-600 rounded-lg font-black text-[10px] hover:bg-red-500 shadow-lg shadow-red-900/20">直撃を受ける</button>
                </div>
            )}
          </>
        )}
      </div>

      {/* 自分の手札（10枚グリッド） */}
      <div className="w-full max-w-4xl">
        <div className="grid grid-cols-5 gap-2 justify-items-center mb-6">
          {myHand?.map((cardName: string, i: number) => {
            const cardInfo = ALL_CARDS.find(c => c.name === cardName);
            const isWeapon = cardInfo?.type === 'weapon';
            const isArmor = cardInfo?.type === 'armor';
            const isHeal = cardInfo?.type === 'heal';
            const isSelected = selectedArmorIndices.includes(i);
            
            let canClick = isMyTurn && gameData.status !== 'finished';
            if (gameData.status === 'attacking' && isArmor) canClick = false;
            if (gameData.status === 'defending' && !isArmor) canClick = false;

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
                className={`w-full aspect-[2/3] max-w-[80px] rounded-lg border-2 flex flex-col items-center justify-between p-1 transition-all ${
                    isSelected ? 'border-blue-400 bg-blue-900/40 -translate-y-2 scale-110 shadow-xl shadow-blue-500/20' :
                    canClick ? 'border-zinc-700 bg-zinc-800 hover:border-yellow-500' : 'border-zinc-900 bg-zinc-950 opacity-20'
                }`}
              >
                <span className="text-2xl mt-1">{cardInfo?.icon}</span>
                <div className="text-center w-full px-0.5">
                    <p className="text-[7px] font-black leading-tight mb-1 truncate">{cardName}</p>
                    <div className={`py-0.5 rounded-full text-[7px] font-bold ${
                        isWeapon ? 'bg-red-900/50 text-red-400' : 
                        isHeal ? 'bg-green-900/50 text-green-400' : 'bg-blue-900/50 text-blue-400'
                    }`}>
                        {isWeapon ? `ATK:${cardInfo?.value}` : isHeal ? `HEAL:${cardInfo?.value}` : `DEF:${cardInfo?.value}`}
                    </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* 自分HP */}
        <div className="max-w-md mx-auto">
            <div className="h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800 mb-1">
              <div className="h-full bg-blue-600 transition-all duration-500 shadow-[0_0_10px_rgba(37,99,235,0.3)]" style={{ width: `${(myHp / 50) * 100}%` }}></div>
            </div>
            <div className="flex justify-between items-center text-[10px] font-black italic text-blue-500 uppercase tracking-tighter">
                <span>Your Prophet</span>
                <span className="text-xl">HP {myHp} / 50</span>
            </div>
        </div>
      </div>
    </main>
  );
}