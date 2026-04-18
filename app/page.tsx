'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

// --- カードデータ定義（iconを画像パスに変更、武器を調整） ---
const WEAPONS = [
  // public/ フォルダの直下にあるので '/ファイル名' で指定します
  { name: '精霊の剣', value: 30, icon: '/剣_transparent.png', type: 'weapon' },
  { name: '鉄の剣', value: 15, icon: '/剣_transparent.png', type: 'weapon' }, // テスト用に同じ画像を使用
  { name: '錆びた剣', value: 10, icon: '/剣_transparent.png', type: 'weapon' },
  { name: '光の聖剣', value: 25, icon: '/剣_transparent.png', type: 'weapon' },
];
const ARMORS = [
  // 防具や回復は、画像が用意できるまで絵文字のままにしています
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
      const { data } = await supabase.from('games').update({ 
        player_b_id: myId, 
        player_b_hand: generateHand(),
        status: 'attacking',
        attacker_id: waitingGame.player_a_id,
        defender_id: myId
      }).eq('id', waitingGame.id).select().single();
      if (data) { setGameId(data.id); setGameData(data); }
    } else {
      // 自分が待機する場合
      const { data } = await supabase.from('games').insert([{ 
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
    if (gameData.status !== 'attacking' || gameData.attacker_id !== myId) return;
    const isPlayerA = gameData.player_a_id === myId;
    const card = ALL_CARDS.find(c => c.name === cardName);
    let hand = isPlayerA ? [...(gameData.player_a_hand || [])] : [...(gameData.player_b_hand || [])];
    
    // 手札更新
    hand.splice(index, 1);
    hand.push(drawCard());

    if (card?.type === 'heal') {
      // 回復してターン終了（攻守交代）
      const currentHp = isPlayerA ? gameData.player_a_hp : gameData.player_b_hp;
      await supabase.from('games').update({
        [isPlayerA ? 'player_a_hp' : 'player_b_hp']: Math.min(50, currentHp + (card.value || 0)),
        [isPlayerA ? 'player_a_hand' : 'player_b_hand']: hand,
        attacker_id: gameData.defender_id, // 攻守交代
        defender_id: gameData.attacker_id,
        status: 'attacking'
      }).eq('id', gameId);
    } else if (card?.type === 'weapon') {
      // 攻撃フェーズへ
      await supabase.from('games').update({
        [isPlayerA ? 'player_a_hand' : 'player_b_hand']: hand,
        selected_card: cardName,
        status: 'defending'
      }).eq('id', gameId);
    }
  };

  // 防御実行
  const executeDefense = async (hit: boolean) => {
    if (gameData.status !== 'defending' || gameData.defender_id !== myId) return;
    const isPlayerA = gameData.player_a_id === myId;
    let hand = isPlayerA ? [...(gameData.player_a_hand || [])] : [...(gameData.player_b_hand || [])];
    let totalDefense = 0;

    if (!hit) {
      // 選択した盾の値を合算して手札から消す
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

  // タイトル画面
  if (!gameId || !gameData) return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black text-white p-4">
      <h1 className="text-7xl font-black mb-12 italic text-transparent bg-clip-text bg-gradient-to-b from-yellow-100 to-yellow-600 tracking-tighter drop-shadow-xl">GOD FIELD</h1>
      <button onClick={startMatching} disabled={loading} className="border-4 border-yellow-500 px-12 py-6 text-3xl font-bold hover:bg-yellow-500 hover:text-black transition-all">
        {loading ? 'WAITING...' : 'ENTER ARENA'}
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
    <main className="flex min-h-screen flex-col items-center justify-between bg-zinc-950 text-white p-4 overflow-hidden">
      {/* 相手側（HPバー） */}
      <div className="w-full max-w-md">
        <div className="flex justify-between items-end mb-1 px-1">
          <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Enemy Prophet</span>
          <span className="text-xl font-black text-red-500 italic">HP {opponentHp}</span>
        </div>
        <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800 shadow-inner">
          <div className="h-full bg-red-600 transition-all duration-500" style={{ width: `${(opponentHp / 50) * 100}%` }}></div>
        </div>
      </div>

      {/* バトルメッセージボード */}
      <div className="text-center w-full bg-zinc-900/30 py-8 rounded-3xl border border-white/5 shadow-2xl backdrop-blur-sm relative">
        {gameData.status === 'finished' ? (
          <div>
            <h2 className="text-6xl font-black text-yellow-500 italic mb-4 drop-shadow-lg">{myHp > 0 ? 'VICTORY' : 'DEFEATED'}</h2>
            <button onClick={() => window.location.reload()} className="px-8 py-2 bg-yellow-500 text-black font-bold rounded-full text-sm">BACK TO TITLE</button>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-black italic text-zinc-100">
                {gameData.status === 'defending' ? `💥 [${gameData.selected_card}] が飛来！` : 'BATTLE PHASE'}
            </h2>
            <p className={`text-xs font-black mt-1 ${isMyTurn ? 'text-yellow-400 animate-pulse' : 'text-zinc-600'}`}>
                {isMyTurn ? ">>> SELECT YOUR MOVE <<<" : "OPPONENT THINKING..."}
            </p>
            {gameData.status === 'defending' && isDefender && (
                <div className="mt-4 flex gap-3 justify-center">
                    <button onClick={() => executeDefense(false)} className="px-5 py-2 bg-blue-600 rounded-lg font-black text-[10px] hover:bg-blue-500">防御実行</button>
                    <button onClick={() => executeDefense(true)} className="px-5 py-2 bg-red-600 rounded-lg font-black text-[10px] hover:bg-red-500">直撃を受ける</button>
                </div>
            )}
          </>
        )}
      </div>

      {/* 自分側（手札10枚） */}
      <div className="w-full max-w-4xl pb-2">
        <div className="grid grid-cols-5 gap-2.5 justify-items-center mb-6 px-2">
          {myHand?.map((cardName: string, i: number) => {
            const cardInfo = ALL_CARDS.find(c => c.name === cardName);
            const isWeapon = cardInfo?.type === 'weapon';
            const isArmor = cardInfo?.type === 'armor';
            const isHeal = cardInfo?.type === 'heal';
            const isSelected = selectedArmorIndices.includes(i);
            
            // 操作可能かどうかの判定
            let canClick = isMyTurn && gameData.status !== 'finished';
            if (gameData.status === 'attacking' && isArmor) canClick = false; // 攻撃番に盾は出せない
            if (gameData.status === 'defending' && !isArmor) canClick = false; // 防御番に武器・回復は出せない

            return (
              <button 
                key={i} 
                onClick={() => {
                    if (gameData.status === 'attacking') useCard(cardName, i);
                    else if (gameData.status === 'defending') {
                        // 防御時は複数選択できるように配列にインデックスを追加/削除
                        setSelectedArmorIndices(prev => prev.includes(i) ? prev.filter(idx => idx !== i) : [...prev, i]);
                    }
                }}
                disabled={!canClick}
                // --- カードのUIデザイン ---
                className={`relative w-full aspect-[2/3] max-w-[85px] rounded-2xl border-2 flex flex-col items-center justify-between p-1 transition-all duration-300 overflow-hidden ${
                    isSelected ? 'border-cyan-400 bg-cyan-900/40 -translate-y-4 scale-110 shadow-[0_0_20px_rgba(34,211,238,0.5)]' :
                    canClick ? 'border-zinc-700 bg-gradient-to-b from-zinc-800 to-zinc-950 hover:border-yellow-500 hover:shadow-[0_0_15px_rgba(250,204,21,0.2)]' : 
                    'border-zinc-900 bg-black opacity-10 scale-95 cursor-not-allowed'
                }`}
              >
                {/* 選択可能時のカード表面の光沢 */}
                {canClick && <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent pointer-events-none" />}
                
                {/* --- アイコン表示（画像か絵文字） --- */}
                {isWeapon && cardInfo?.icon ? (
                  // 武器の場合は追加した画像を表示
                  <img src={cardInfo.icon} alt={cardName} className="w-[85%] aspect-square object-contain mt-3 drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]" />
                ) : (
                  // それ以外は絵文字を表示
                  <span className="text-3xl mt-3 drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">{cardInfo?.icon}</span>
                )}
                
                {/* カード下部のステータスエリア */}
                <div className="text-center w-full z-10 bg-black/50 backdrop-blur-sm py-1 rounded-b-xl px-0.5">
                    <p className="text-[7px] font-black leading-tight mb-1 truncate px-1 text-zinc-100 uppercase tracking-tighter">
                      {cardName}
                    </p>
                    {/* ATK/DEF/HEALの数値表示 */}
                    <div className={`px-1 py-0.5 rounded-md text-[7px] font-black shadow-inner ${
                        isWeapon ? 'bg-red-950/70 text-red-400' : 
                        isHeal ? 'bg-green-950/70 text-green-400' : 'bg-blue-950/70 text-blue-400'
                    }`}>
                        {cardInfo?.value}
                    </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* 自分側情報（HPバー） */}
        <div className="max-w-md mx-auto px-1">
            <div className="h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800 shadow-inner mb-1.5">
              <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${(myHp / 50) * 100}%` }}></div>
            </div>
            <div className="flex justify-between items-center text-[10px] font-black italic text-blue-500">
                <span>Your Prophet</span>
                <span className="text-xl">HP {myHp} / 50</span>
            </div>
        </div>
      </div>
    </main>
  );
}