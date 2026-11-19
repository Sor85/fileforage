import { AnimatePresence, motion } from "motion/react"

import { AppHeader } from "@/components/app-header"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ViewerHost } from "@/components/viewer/viewer"
import { LibraryPage } from "@/pages/library-page"
import { SearchPage } from "@/pages/search-page"
import { SettingsPage } from "@/pages/settings-page"
import { useLocation } from "@/lib/router"

export default function App() {
  const { route } = useLocation()
  return (
    <TooltipProvider delayDuration={400}>
      <div data-modal-stack-root className="app-root relative isolate flex h-dvh flex-col overflow-hidden bg-background">
        <AppHeader route={route} />
        <ScrollArea className="flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.main
              key={route}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            >
              {route === "search" && <SearchPage />}
              {route === "library" && <LibraryPage />}
              {route === "settings" && <SettingsPage />}
            </motion.main>
          </AnimatePresence>
        </ScrollArea>
      </div>
      <ViewerHost />
      <Toaster />
    </TooltipProvider>
  )
}
