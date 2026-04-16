'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

export default function JankenBattlePage() {
  const [myId] = useState(uuidv4());
  const [gameId, setGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [gameData, setGameData] = useState<any>(null);
  const [myChoice, setMyChoice] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const iconMap: { [key: string]: string } = { rock: '✊', scissors: '✌️', paper: '✋' };

  // 1. リアルタイム監視
  useEffect(() => {
    if (!gameId) return;

    const channel = supabase
      .channel(`game-${gameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        async (payload) => {
          const newData = payload.new;
          setGameData(newData);

          // 両者の手が揃ったらダメージ計算（Player Aが代表して計算する）
          if (newData.choice_a && newData.choice_b && !isProcessing) {
            if (newData.player_a_id === myId) {
              await processRound(newData);
            }
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [gameId, myId, isProcessing]);

  // 2. ラウンド解決（ダメージ計算）
  const processRound = async (currentData: any) => {
    setIsProcessing(true);
    // 少し待ってから結果を反映（演出用）
    await new Promise(resolve => setTimeout(resolve, 1500));

    let nextHpA = currentData.player_a_hp;
    let nextHpB = currentData.player_b_hp;
    let nextStatus = 'playing';

    // 勝敗判定
    const a = currentData.choice_a;
    const b = currentData.choice_b;

    if (a !== b) {
      if ((a === 'rock' && b === 'scissors') || (a === 'scissors' && b === 'paper') || (a === 'paper' && b === 'rock')) {
        nextHpB -= 10; // Bの負け
      } else {
        nextHpA -= 10; // Aの負け
      }
    }

    // 決着がついたかチェック
    if (nextHpA <= 0 || nextHpB <= 0) {
      nextStatus = 'finished';
    }

    // データベースを更新して手をリセット
    await supabase.from('games').update({
      player_a_hp: Math.max(0, nextHpA),
      player_b_hp: Math.max(0, nextHpB),
      choice_a: null,
      choice_b: null,
      status: nextStatus
    }).eq('id', gameId);

    setMyChoice(null);
    setIsProcessing(false);
  };

  // 3. マッチング
  const startMatching = async () => {
    setLoading(true);
    const { data: waitingGame } = await supabase.from('games').select('*').eq('status', 'waiting').maybeSingle();

    if (waitingGame) {
      const { data } = await supabase.from('games').update({ player_b_id: myId, status: 'playing' }).eq('id', waitingGame.id).select().single();
      setGameId(data.id);
      setGameData(data);
    } else {
      const { data } = await supabase.from('games').insert([{ player_a_id: myId, status: 'waiting' }]).select().single();
      setGameId(data.id);
      setGameData(data);
    }
    setLoading(false);
  };

  const sendChoice = async (choice: string) => {
    if (!gameId || myChoice) return;
    setMyChoice(choice);
    if (gameData.player_a_id === myId) {
      await supabase.from('games').update({ choice_a: choice }).eq('id', gameId);
    } else {
      await supabase.from('games').update({ choice_b: choice }).eq('id', gameId);
    }
  };

  if (!gameId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-black text-white p-4">
        <h1 className="text-6xl font-black mb-12 italic text-red-600 tracking-tighter">BATTLE FIELD</h1>
        <button onClick={startMatching} disabled={loading} className="border-4 border-red-600 px-12 py-6 text-3xl font-bold hover:bg-red-600 transition-all active:scale-95 shadow-[0_0_20px_rgba(220,38,38,0.5)]">
          {loading ? 'SEARCHING...' : 'ENTER ARENA'}
        </button>
      </main>
    );
  }

  const isPlayerA = gameData?.player_a_id === myId;
  const myHp = isPlayerA ? gameData?.player_a_hp : gameData?.player_b_hp;
  const opponentHp = isPlayerA ? gameData?.player_b_hp : gameData?.player_a_hp;
  const opponentReady = isPlayerA ? !!gameData?.choice_b : !!gameData?.choice_a;

  return (
    <main className="flex min-h-screen flex-col items-center justify-between bg-zinc-950 text-white p-8">
      {/* 相手の情報 */}
      <div className="w-full max-w-md text-center">
        <div className="flex justify-between items-end mb-2">
          <span className="text-sm font-bold text-zinc-500">ENEMY PREDICTOR</span>
          <span className="text-2xl font-black text-red-500">HP {opponentHp}</span>
        </div>
        <div className="h-4 bg-zinc-800 rounded-full overflow-hidden border border-zinc-700">
          <div className="h-full bg-red-600 transition-all duration-500" style={{ width: `${(opponentHp / 50) * 100}%` }}></div>
        </div>
        <div className="mt-4 h-20 text-5xl flex items-center justify-center bg-zinc-900/50 rounded-xl">
          {opponentReady ? '⚡️ READY' : '...'}
        </div>
      </div>

      {/* バトルメッセージ */}
      <div className="text-center">
        {gameData?.status === 'finished' ? (
          <div className="animate-bounce">
            <h2 className="text-7xl font-black text-yellow-400">{myHp > 0 ? 'VICTORY' : 'DEFEATED'}</h2>
            <button onClick={() => window.location.reload()} className="mt-8 text-xl underline">BACK TO TITLE</button>
          </div>
        ) : (
          <div className="text-2xl font-mono text-zinc-400">VS</div>
        )}
      </div>

      {/* 自分の情報 */}
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex gap-4 justify-center">
          {['rock', 'scissors', 'paper'].map((c) => (
            <button
              key={c}
              onClick={() => sendChoice(c)}
              disabled={!!myChoice || gameData?.status === 'finished'}
              className={`text-5xl p-6 rounded-2xl border-2 transition-all ${
                myChoice === c ? 'border-blue-500 bg-blue-900/40 scale-110' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
              } ${myChoice ? 'opacity-50' : 'active:scale-90'}`}
            >
              {iconMap[c]}
            </button>
          ))}
        </div>
        <div className="h-4 bg-zinc-800 rounded-full overflow-hidden border border-zinc-700">
          <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${(myHp / 50) * 100}%` }}></div>
        </div>
        <div className="flex justify-between items-start mt-2">
          <span className="text-2xl font-black text-blue-500">HP {myHp}</span>
          <span className="text-sm font-bold text-zinc-500">YOU (PROPHET)</span>
        </div>
      </div>
    </main>
  );
}