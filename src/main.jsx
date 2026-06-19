import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app.jsx'
import './index.css'
import { inject } from '@vercel/analytics'

inject()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
