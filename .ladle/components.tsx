import type { GlobalProvider } from '@ladle/react'
import './ladle.css'

export const Provider: GlobalProvider = ({ children }) => (
  <>{children}</>
)
