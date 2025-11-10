import { useState } from 'react';
import { authAPI } from '../utils/api';

interface LoginFormProps {
  onLogin: () => void;
}

export default function LoginForm({ onLogin }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await authAPI.login(username, password);
      
      if (result.status === 'success') {
        localStorage.setItem('token', result.token);
        localStorage.setItem('user', JSON.stringify(result.data.user));
        onLogin();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-xl p-8 border border-gray-700">
      <h2 className="text-2xl font-bold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent mb-2 text-center">
        Login to Book Meeting Room
      </h2>
      <p className="text-gray-400 text-center mb-6">Access your meeting room booking dashboard</p>
      
      {error && (
        <div className="bg-red-900/50 border border-red-700/50 text-red-200 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white placeholder-gray-400 transition-all duration-200"
            required
            placeholder="Enter your username"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white placeholder-gray-400 transition-all duration-200"
            required
            placeholder="Enter your password"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#f37121] hover:to-[#e5651a] text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform "
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
              Logging in...
            </span>
          ) : (
            'Login'
          )}
        </button>
      </form>

      {/* <div className="mt-6 p-4 bg-gray-700/50 rounded-lg border border-gray-600">
        <p className="font-medium text-[#f37121] text-sm mb-2">Test Accounts:</p>
        <div className="text-xs text-gray-400 space-y-1">
          <div className="flex justify-between">
            <span>User 1:</span>
            <span>user1 / password123</span>
          </div>
          <div className="flex justify-between">
            <span>User 2:</span>
            <span>user2 / password123</span>
          </div>
          <div className="flex justify-between">
            <span>Admin:</span>
            <span>admin / admin123</span>
          </div>
        </div>
      </div> */}
    </div>
  );
}