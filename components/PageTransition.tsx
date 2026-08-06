'use client'

import { motion } from 'framer-motion'
import { usePathname } from 'next/navigation'

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    // Fade only, no y-offset: pages now open with a sticky <PageHeader />, and a
    // transformed ancestor is an unreliable place to hang `position: sticky`.
    <motion.div
      key={pathname}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      // min-h-full, not flex-1 + min-h-0: inside a scrolling parent that combo
      // caps the box at one viewport and lets tall content spill outside it.
      // A floor of full height still lets full-bleed pages fill the frame.
      //
      // [&>*]:shrink-0 because min-h-full pins this box to exactly one viewport
      // while its children keep their natural heights. On a page taller than the
      // viewport that leaves negative free space, and flex answers by squeezing
      // every child — including fixed-height ones. That is what crushed the
      // h-16 <PageHeader /> down to its min-content height on long pages and ate
      // the trailing padding off page bodies. Growing (flex-1) still works: free
      // space is positive there, so shrink never applies.
      className="flex min-h-full w-full flex-col [&>*]:shrink-0"
    >
      {children}
    </motion.div>
  )
}