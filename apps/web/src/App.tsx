import { useEffect, useState } from 'react'
import axios from 'axios'
import './App.css'

function App() {
  const [message, setMessage] = useState('Checking backend...')
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    axios
      .get('http://127.0.0.1:8000/api/health')
      .then((response) => {
        setMessage(response.data.message)
        setConnected(true)
      })
      .catch(() => {
        setMessage('Cannot connect to Laravel API')
        setConnected(false)
      })
  }, [])

  return (
    <div>
      <h1>Carlos Paradise RBMS</h1>

      <h2>
        Backend Status: {connected ? '🟢 Connected' : '🔴 Disconnected'}
      </h2>

      <p>{message}</p>
    </div>
  )
}

export default App