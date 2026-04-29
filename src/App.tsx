import { useEffect, useState, useRef } from 'react';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { AudioRecorder, AudioStreamer } from './lib/audio';
import { Square, Loader2, Power, LogOut, Volume2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

const SYSTEM_INSTRUCTION = `
You are Maximus, a modern Voice Agent and assistant.
The user is "Master E".
You must sound like a real human. High priority: Tailored for normal human conversation.
Things to avoid to sound native:
1. Avoid speaking too formally all the time.
2. Avoid full textbook sentences in casual talk.
3. Avoid overusing "very" (use "really", "so").
4. Avoid translating directly from other languages.
5. Avoid saying every word perfectly ("gonna", "wanna" are fine).
6. Avoid big words when simple ones sound better ("need help" over "require assistance").
7. Avoid sounding too direct or rude.
8. Avoid always saying just "yes" or "no" alone ("Yeah", "Nah", "Sure").
9. Avoid repeating "I understand" ("Got it", "Makes sense").
10. Avoid repeating the person's full question.
11. Avoid using "maybe" when you mean "probably".
12. Avoid overusing "actually", "bro", "dude", or slang.
13. Avoid saying "How are you?" every time ("What's up?").
14. Avoid answering too seriously when the question is casual.
15. Avoid unnatural greetings and endings ("Talk later" not "I will now end this").
16. Avoid saying "I'm fine" too much ("I'm good").
17. Avoid using "of course" for everything.
18. Avoid being too perfect.
19. Avoid robotic emotional replies ("That's hilarious" or "That sucks").
20. Avoid unnatural apologies ("My bad", "Sorry about that").
Keep it simple, relaxed, clear, polite, and casual when appropriate. Be natural and spontaneous. Keep responses relatively short suitable for a voice agent.
`;

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Initialize user doc
        try {
          const userRef = doc(db, 'users', u.uid);
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              displayName: u.displayName || 'Master E',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              settings: {}
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'users');
        }
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error(error);
    }
  };

  const handleLogout = () => signOut(auth);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
        {/* Abstract background */}
        <div className="absolute top-0 left-1/2 -ml-[400px] w-[800px] h-[800px] bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="relative z-10 flex flex-col items-center max-w-sm w-full">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-amber-500 to-amber-700 p-[1px] mb-8 shadow-2xl shadow-amber-500/20">
             <div className="w-full h-full rounded-3xl bg-[#0A0A0B] flex items-center justify-center">
               <Volume2 className="w-10 h-10 text-amber-500" />
             </div>
          </div>
          <h1 className="text-4xl font-light tracking-tight mb-2 text-white">Maximus</h1>
          <p className="text-gray-400 text-center mb-10 leading-relaxed font-serif italic">Your native-sounding personal AI agent.</p>
          
          <button 
            onClick={handleLogin}
            className="w-full bg-amber-500 text-black font-semibold text-lg py-4 rounded-full hover:bg-amber-400 transition-colors active:scale-[0.98] shadow-lg shadow-amber-500/20"
          >
            Authenticate
          </button>
        </div>
      </div>
    );
  }

  return <MaximusAgent user={user} onLogout={handleLogout} />;
}

function MaximusAgent({ user, onLogout }: { user: User, onLogout: () => void }) {
  const [isActive, setIsActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  
  const aiRef = useRef<GoogleGenAI | null>(null);
  const sessionRef = useRef<any>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);

  useEffect(() => {
    // We get the key injected from AI Studio environment variables
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      aiRef.current = new GoogleGenAI({ apiKey });
    }
    audioStreamerRef.current = new AudioStreamer();
    return () => {
      audioStreamerRef.current?.stop();
      audioRecorderRef.current?.stop();
      sessionRef.current?.close();
    };
  }, []);

  const startSession = async () => {
    if (!aiRef.current) {
        alert("API key is not available");
        return;
    }
    
    setConnecting(true);
    
    try {
      await audioStreamerRef.current?.init(24000);
      
      const sessionPromise = aiRef.current.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
             console.log("Connected to Maximus.");
             // Start recording
             audioRecorderRef.current = new AudioRecorder((base64Data) => {
               sessionPromise.then((session: any) => {
                 session.sendRealtimeInput({
                   audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                 });
               });
             });
             audioRecorderRef.current.start();
             setIsActive(true);
             setConnecting(false);
          },
          onmessage: async (message: LiveServerMessage) => {
             if (message.serverContent) {
                // Handle audio output from agent
                const parts = message.serverContent.modelTurn?.parts;
                if (parts && parts.length > 0) {
                   const audioData = parts[0]?.inlineData?.data;
                   if (audioData) {
                       audioStreamerRef.current?.addPCM16(audioData);
                       setIsAgentSpeaking(true);
                       // Quick hack to reset speaking state
                       setTimeout(() => setIsAgentSpeaking(false), 500);
                   }
                }
                
                // Handle text transcriptions
                // Model output transcription
                /* Note: actual SDK typing might vary, but outputAudioTranscription is usually within modelTurn if provided, 
                   or handled in a separate field depending on genai version. 
                   Typically we would look for text inside parts if Modality includes both. 
                   Since we enforce AUDIO only, we might get transcript in other fields or need to rely on just audio.
                */
                // For simplicity we show a generic status if we don't safely parse the transcription fields.
             }
          },
          onclose: () => {
             console.log("Disconnected from Maximus.");
             stopSession();
          },
          onerror: (err: any) => {
             console.error("Live API Error:", err);
             stopSession();
          }
        }
      });
      
      sessionRef.current = await sessionPromise;
      
    } catch (err) {
      console.error(err);
      setConnecting(false);
      stopSession();
    }
  };

  const stopSession = () => {
     audioRecorderRef.current?.stop();
     audioStreamerRef.current?.stop();
     sessionRef.current?.close();
     setIsActive(false);
     setConnecting(false);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col h-[100dvh] overflow-hidden">
        {/* Header */}
        <header className="px-8 py-6 flex items-center justify-between border-b border-white/5 bg-[#050505] z-20">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.2em] text-amber-500/80 font-semibold">Primary User</span>
            <h1 className="text-2xl font-light tracking-tight text-white">{user.displayName || 'Master E'}</h1>
          </div>
          
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 p-[1px]">
               <div className="w-full h-full rounded-2xl bg-[#0A0A0B] flex items-center justify-center overflow-hidden">
                 {user.photoURL ? (
                    <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
                 ) : (
                    <span className="text-amber-500 font-serif text-xl italic">{user.displayName?.charAt(0) || 'M'}</span>
                 )}
               </div>
             </div>
             
             <button onClick={onLogout} className="p-2.5 rounded-full hover:bg-white/5 transition-colors text-gray-500 hover:text-gray-300">
               <LogOut className="w-5 h-5" />
             </button>
          </div>
        </header>

        {/* Main Interface */}
        <main className="flex-1 flex flex-col items-center justify-center relative p-6">
           {/* Center Canvas / Visualizer */}
           <div className="relative w-full max-w-sm aspect-square flex items-center justify-center mb-12">
               
               {/* Pulsing ring visualizer */}
               <AnimatePresence>
                 {isActive && (
                   <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: isAgentSpeaking ? 1.4 : 1.1, opacity: isAgentSpeaking ? 0.3 : 0.1 }}
                      transition={{ duration: isAgentSpeaking ? 0.2 : 1, repeat: Infinity, repeatType: "reverse" }}
                      className="absolute inset-0 rounded-full bg-gradient-to-tr from-amber-500 via-amber-400 to-orange-500 blur-3xl opacity-20"
                   />
                 )}
               </AnimatePresence>
               
               {/* Decorative Outer Rings */}
               {isActive && (
                 <>
                   <div className="absolute w-64 h-64 rounded-full border border-amber-500/10 scale-125"></div>
                   <div className="absolute w-64 h-64 rounded-full border border-amber-500/20 scale-110"></div>
                 </>
               )}

               {/* Orb */}
               <motion.div 
                 animate={{
                    scale: isActive ? (isAgentSpeaking ? [1, 1.05, 1] : [1, 1.01, 1]) : 1,
                    boxShadow: isActive ? '0 0 50px rgba(245, 158, 11, 0.15)' : '0 0 0px rgba(0,0,0,0)'
                 }}
                 transition={{
                   duration: isAgentSpeaking ? 0.4 : 2,
                   repeat: Infinity,
                   repeatType: "reverse"
                 }}
                 className="relative z-10 w-48 h-48 rounded-full shadow-2xl flex items-center justify-center overflow-hidden"
                 style={{
                   background: isActive 
                     ? 'linear-gradient(180deg, rgba(245, 158, 11, 0.15) 0%, transparent 100%)' 
                     : 'linear-gradient(135deg, #09090b 0%, #18181b 100%)',
                   border: isActive ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(255,255,255,0.05)',
                   backdropFilter: 'blur(24px)'
                 }}
               >
                 {connecting ? (
                   <Loader2 className="w-10 h-10 animate-spin text-amber-400" />
                 ) : (
                    isActive ? (
                        <div className="flex gap-1.5 items-end h-8">
                            <motion.div animate={{ height: isAgentSpeaking ? ['16px', '32px', '16px'] : '16px' }} transition={{ duration: 0.4, repeat: Infinity }} className="w-1.5 bg-amber-500 rounded-full" />
                            <motion.div animate={{ height: isAgentSpeaking ? ['32px', '40px', '32px'] : '32px' }} transition={{ duration: 0.5, repeat: Infinity, delay: 0.1 }} className="w-1.5 bg-amber-500 rounded-full" />
                            <motion.div animate={{ height: isAgentSpeaking ? ['24px', '48px', '24px'] : '24px' }} transition={{ duration: 0.3, repeat: Infinity, delay: 0.2 }} className="w-1.5 bg-amber-500 rounded-full" />
                            <motion.div animate={{ height: isAgentSpeaking ? ['40px', '24px', '40px'] : '40px' }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.15 }} className="w-1.5 bg-amber-500 rounded-full" />
                            <motion.div animate={{ height: isAgentSpeaking ? ['20px', '32px', '20px'] : '20px' }} transition={{ duration: 0.4, repeat: Infinity, delay: 0.05 }} className="w-1.5 bg-amber-500 rounded-full" />
                        </div>
                    ) : (
                       <div className="text-center">
                         <p className="text-[10px] font-bold tracking-widest text-gray-500 uppercase mb-1">Standby</p>
                         <h2 className="text-2xl font-serif italic text-amber-500">Maximus</h2>
                       </div>
                    )
                 )}
               </motion.div>
           </div>

           {/* Controls */}
           <div className="flex flex-col items-center gap-6 mt-8">
              {!isActive ? (
                <button 
                  onClick={startSession}
                  disabled={connecting}
                  className="w-16 h-16 bg-gradient-to-br from-amber-500 to-amber-700 p-[1px] rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100 shadow-[0_0_20px_rgba(245,158,11,0.2)]"
                >
                  <div className="w-full h-full rounded-full bg-[#0A0A0B] flex items-center justify-center">
                    <Power className="w-6 h-6 text-amber-500" />
                  </div>
                </button>
              ) : (
                <button 
                  onClick={stopSession}
                  className="w-16 h-16 bg-red-500/10 border border-red-500/30 text-red-500 rounded-full flex items-center justify-center hover:bg-red-500/20 hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(239,68,68,0.2)]"
                >
                  <Square className="w-6 h-6 fill-current" />
                </button>
              )}
              
              <p className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">
                {isActive ? 'Active Session' : 'Tap to initialize'}
              </p>
           </div>
        </main>
    </div>
  );
}
