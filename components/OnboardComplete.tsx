'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactConfetti from 'react-confetti'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface OnboardingSuccessDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function OnboardingSuccessDialog({ isOpen, onClose }: OnboardingSuccessDialogProps) {
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 })
  const [showConfetti, setShowConfetti] = useState(false)
  const prefersReducedMotion = useRef(false)

  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  useEffect(() => {
    const onResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight })
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!isOpen || prefersReducedMotion.current) return
    const timer = setTimeout(() => setShowConfetti(true), 100)
    return () => clearTimeout(timer)
  }, [isOpen])

  const handleConfettiComplete = useCallback(() => {
    setShowConfetti(false)
  }, [])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <motion.div
            className="absolute inset-0 bg-black/40"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />

          {showConfetti && windowSize.width > 0 && (
            <ReactConfetti
              width={windowSize.width}
              height={windowSize.height}
              numberOfPieces={300}
              recycle={false}
              colors={['#1a1a1a', '#4d4d4d', '#808080', '#cccccc']}
              gravity={0.12}
              tweenDuration={3000}
              onConfettiComplete={handleConfettiComplete}
              style={{ position: 'fixed', top: 0, left: 0, zIndex: 60, pointerEvents: 'none' }}
            />
          )}

          <motion.div
            className="relative z-50 bg-background rounded-xl shadow-floating max-w-sm w-full p-8"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-foreground">
                <Check className="h-7 w-7 text-background" strokeWidth={2.5} />
              </div>

              <h2 className="text-xl font-semibold tracking-tight text-foreground mb-2">
                Your account is set up
              </h2>

              <p className="text-muted-foreground text-sm leading-relaxed mb-7">
                NeatMail is now sorting your inbox. You&apos;ll get a daily digest and alerts wherever you prefer.
              </p>

              <Button
                onClick={onClose}
                className="w-full h-11 text-base font-medium"
              >
                Get Started
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
