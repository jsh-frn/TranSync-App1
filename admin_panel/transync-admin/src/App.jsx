import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import UserManagement from './pages/UserManagement'
import Overview from './pages/Overview'
import VerifyUsers from './pages/VerifyUsers'
import TerminalManagement from './pages/TerminalManagement'
import RouteLibrary from './pages/RouteLibrary'
import RouteTerminalManagement from './pages/RouteTerminalManagement'
import SystemWallet from './pages/SystemWallet'
import LtfrbFareGuide from './pages/LtfrbFareGuide'
import Settings from './pages/Settings'

function PrivateRoute({ children }) {
  const admin = localStorage.getItem('admin')
  return admin ? children : <Navigate to="/" />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/overview" element={<PrivateRoute><Overview /></PrivateRoute>} />
      <Route path="/user-management" element={<PrivateRoute><UserManagement /></PrivateRoute>} />
      <Route path="/verify-users" element={<PrivateRoute><VerifyUsers /></PrivateRoute>} /> 
      <Route path="/terminal-management" element={<PrivateRoute><TerminalManagement /></PrivateRoute>} />
      <Route path="/route-library" element={<PrivateRoute><RouteLibrary /></PrivateRoute>} />
      <Route path="/route-terminal-management" element={<PrivateRoute><RouteTerminalManagement /></PrivateRoute>} />
      <Route path="/system-wallet" element={<PrivateRoute><SystemWallet /></PrivateRoute>} />
      <Route path="/ltfrb-fare-guide" element={<PrivateRoute><LtfrbFareGuide /></PrivateRoute>} />
      <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
    </Routes>
  )
}