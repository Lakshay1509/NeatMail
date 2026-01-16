import { useEffect, useState } from 'react';
import { Mail, Check } from 'lucide-react';

interface OnboardingSuccessDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Confetti {
  id: number;
  left: number;
  delay: number;
  duration: number;
  color: string;
}

export default function OnboardingSuccessDialog({ isOpen, onClose }: OnboardingSuccessDialogProps) {
  const [confetti, setConfetti] = useState<Confetti[]>([]);

  useEffect(() => {
    if (isOpen) {
      const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
      const pieces: Confetti[] = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 2 + Math.random() * 1,
        color: colors[Math.floor(Math.random() * colors.length)],
      }));
      setConfetti(pieces);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-scale-in overflow-hidden">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {confetti.map((piece) => (
            <div
              key={piece.id}
              className="confetti-piece"
              style={{
                left: `${piece.left}%`,
                animationDelay: `${piece.delay}s`,
                animationDuration: `${piece.duration}s`,
                backgroundColor: piece.color,
              }}
            />
          ))}
        </div>

        <div className="relative z-10">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="w-20 h-20 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center animate-bounce-in">
                <Check className="w-10 h-10 text-white" strokeWidth={3} />
              </div>
              <div className="absolute -top-1 -right-1 w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center animate-scale-in-delayed">
                <Mail className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 text-center mb-3">
            Your account is setup!
          </h2>

          <p className="text-gray-600 text-center mb-8 leading-relaxed">
            NeatMail will watch the incoming mails in your inbox and keep everything organized for you.
          </p>

          <button
            onClick={onClose}
            className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 transform hover:scale-105 active:scale-95 shadow-lg"
          >
            Get Started
          </button>
        </div>
      </div>

      <style>{`
        @keyframes scale-in {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes bounce-in {
          0% {
            opacity: 0;
            transform: scale(0);
          }
          50% {
            transform: scale(1.1);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes scale-in-delayed {
          0%, 20% {
            opacity: 0;
            transform: scale(0);
          }
          50% {
            transform: scale(1.2);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes confetti-fall {
          0% {
            transform: translateY(-100vh) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }

        .animate-scale-in {
          animation: scale-in 0.3s ease-out;
        }

        .animate-bounce-in {
          animation: bounce-in 0.6s ease-out;
        }

        .animate-scale-in-delayed {
          animation: scale-in-delayed 0.8s ease-out;
        }

        .confetti-piece {
          position: absolute;
          width: 10px;
          height: 10px;
          animation: confetti-fall linear forwards;
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
}
