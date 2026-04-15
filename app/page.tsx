'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

export default function JankenPage() {
  const [myId] = useState(uuidv4());
  const [gameId, setGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [myChoice, setMyChoice] = useState<string | null>(null);
  const [opponentChoice, setOpponentChoice] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'waiting' | 'playing' | 'finished'>('idle');
  const [result, setResult] = useState<string>('');

  // 勝敗を判定する関数
  const judge = (me: string, opp: string) => {
    if (me === opp) return '引き分け！';
    if (
      (me === 'rock' && opp === 'scissors') ||
      (me === 'scissors' && opp === 'paper') ||
      (me === 'paper' && opp === 'rock')
    ) {
      return 'あなたの勝ち！🎉';
    }
    return 'あなたの負け...😭';
  };

  useEffect(() => {
    if (!gameId) return;

    const channel = supabase
      .channel(`game-${gameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => {
          const data = payload.new;
          
          if (data.status === 'playing' && status === 'waiting') {
            setStatus('playing');
          }

          let opp: string | null = null;
          if (data.player_a_id === myId) {
            opp = data.choice_b;
          } else {
            opp = data.choice_a;
          }
          setOpponentChoice(opp);

          // 自分と相手の手が両方揃ったら
          if (myChoice && opp) {
            setResult(judge(myChoice, opp));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, myId, status, myChoice]);

  const startMatching = async () => {
    setLoading(true);
    setMyChoice(null);
    setOpponentChoice(null);
    setResult('');
    
    const { data: waitingGame } = await supabase
      .from('games')
      .select('*')
      .eq('status', 'waiting')
      .limit(1)
      .maybeSingle();

    if (waitingGame) {
      await supabase.from('games').update({ player_b_id: myId, status: 'playing' }).eq('id', waitingGame.id);
      setGameId(waitingGame.id);
      setStatus('playing');
    } else {
      const { data } = await supabase.from('games').insert([{ player_a_id: myId, status: 'waiting' }]).select().single();
      if (data) {
        setGameId(data.id);
        setStatus('waiting');
      }
    }
    setLoading(false);
  };

  const sendChoice = async (choice: string) => {
    if (!gameId) return;
    setMyChoice(choice);

    const { data: game } = await supabase.from('games').select('*').eq('id', gameId).single();
    if (game.player_a_id === myId) {
      await supabase.from('games').update({ choice_a: choice }).eq('id', gameId);
    } else {
      await supabase.from('games').update({ choice_b: choice }).eq('id', gameId);
    }
  };

  const iconMap: { [key: string]: string } = { rock: '✊', scissors: '✌️', paper: '✋' };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-slate-900 text-white font-sans">
      <h1 className="text-4xl font-bold mb-12 tracking-tighter">ONLINE JANKEN</h1>

      {status === 'idle' && (
        <button onClick={startMatching} disabled={loading} className="bg-blue-600 hover:bg-blue-500 px-10 py-5 rounded-full font-black text-2xl transition-all shadow-lg active:scale-95">
          {loading ? 'SEARCHING...' : 'BATTLE START'}
        </button>
      )}

      {status === 'waiting' && (
        <div className="text-center animate-bounce">
          <p className="text-2xl font-bold">WAITING FOR RIVAL...</p>
        </div>
      )}

      {status === 'playing' && (
        <div className="bg-slate-800 p-10 rounded-3xl shadow-2xl text-center border-2 border-slate-700 w-full max-w-md">
          <div className="flex justify-between mb-10">
            <div className="flex flex-col items-center">
              <span className="text-xs text-slate-400 mb-2">YOU</span>
              <div className="text-6xl">{myChoice ? iconMap[myChoice] : '❓'}</div>
            </div>
            <div className="text-4xl self-center font-black text-slate-600">VS</div>
            <div className="flex flex-col items-center">
              <span className="text-xs text-slate-400 mb-2">RIVAL</span>
              <div className="text-6xl">{opponentChoice ? (myChoice ? iconMap[opponentChoice] : '✅') : '...'}</div>
            </div>
          </div>

          {!myChoice ? (
            <div className="flex gap-4 justify-center">
              {['rock', 'scissors', 'paper'].map((c) => (
                <button key={c} onClick={() => sendChoice(c)} className="text-4xl p-5 bg-slate-700 hover:bg-blue-600 rounded-2xl transition-all active:scale-90">
                  {iconMap[c]}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4">
              {result ? (
                <div className="animate-in fade-in zoom-in duration-300">
                  <h2 className="text-3xl font-black mb-6 text-yellow-400">{result}</h2>
                  <button onClick={() => setStatus('idle')} className="bg-white text-slate-900 px-6 py-2 rounded-full font-bold hover:bg-slate-200 transition-colors">
                    もう一回遊ぶ
                  </button>
                </div>
              ) : (
                <p className="text-slate-400 italic">相手の回答を待っています...</p>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}