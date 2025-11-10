
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { User } from '../types';
import { adminAPI } from '../utils/api';

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    fullName: '',
    role: 'user' as 'user' | 'admin',
    bookingPermissions: {
      smallRoom: true,
      largeRoom: false
    }
  });
  const [permissionsData, setPermissionsData] = useState({
    smallRoom: true,
    largeRoom: false
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const result = await adminAPI.getAllUsers();
      if (result.status === 'success') {
        setUsers(result.data.users);
      }
    } catch (error) {
      console.error('Error loading users:', error);
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      const result = await adminAPI.createUser(formData);
      if (result.status === 'success') {
        setUsers(prev => [...prev, result.data.user]);
        setShowCreateModal(false);
        setFormData({ 
          username: '', 
          password: '', 
          fullName: '', 
          role: 'user',
          bookingPermissions: {
            smallRoom: true,
            largeRoom: false
          }
        });
        setSuccess('User created successfully');
      } else {
        setError(result.message || 'Failed to create user');
      }
    } catch (error) {
      setError('Failed to create user');
    }
  };

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    setFormData({
      username: user.username,
      password: '',
      fullName: user.fullName,
      role: user.role,
      bookingPermissions: user.bookingPermissions || {
        smallRoom: true,
        largeRoom: false
      }
    });
    setShowEditModal(true);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setError('');
    setSuccess('');

    try {
      const result = await adminAPI.updateUser(selectedUser._id || selectedUser.id, formData);
      if (result.status === 'success') {
        setUsers(prev => prev.map(user => 
          (user._id === selectedUser._id || user.id === selectedUser.id)
            ? result.data.user 
            : user
        ));
        setShowEditModal(false);
        setSelectedUser(null);
        setFormData({ 
          username: '', 
          password: '', 
          fullName: '', 
          role: 'user',
          bookingPermissions: {
            smallRoom: true,
            largeRoom: false
          }
        });
        setSuccess('User updated successfully');
      } else {
        setError(result.message || 'Failed to update user');
      }
    } catch (error) {
      setError('Failed to update user');
    }
  };

  const handlePermissions = (user: User) => {
    setSelectedUser(user);
    setPermissionsData(user.bookingPermissions || {
      smallRoom: true,
      largeRoom: false
    });
    setShowPermissionsModal(true);
  };

  const handleUpdatePermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setError('');
    setSuccess('');

    try {
      const result = await adminAPI.updateUserPermissions(selectedUser._id || selectedUser.id, permissionsData);
      if (result.status === 'success') {
        setUsers(prev => prev.map(user => 
          (user._id === selectedUser._id || user.id === selectedUser.id)
            ? result.data.user 
            : user
        ));
        setShowPermissionsModal(false);
        setSelectedUser(null);
        setSuccess('User permissions updated successfully');
      } else {
        setError(result.message || 'Failed to update permissions');
      }
    } catch (error) {
      setError('Failed to update permissions');
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (confirm('Are you sure you want to delete this user?')) {
      try {
        const result = await adminAPI.deleteUser(id);
        if (result.status === 'success') {
          setUsers(prev => prev.filter(user => (user._id !== id && user.id !== id)));
          setSuccess('User deleted successfully');
        } else {
          setError(result.message || 'Failed to delete user');
        }
      } catch (error) {
        setError('Failed to delete user');
      }
    }
  };

  const getPermissionsText = (user: User) => {
    const permissions = user.bookingPermissions || { smallRoom: true, largeRoom: false };
    if (permissions.smallRoom && permissions.largeRoom) {
      return 'All Rooms';
    } else if (permissions.smallRoom) {
      return 'Small Room Only';
    } else if (permissions.largeRoom) {
      return 'Large Room Only';
    } else {
      return 'No Access';
    }
  };

  const getPermissionsColor = (user: User) => {
    const permissions = user.bookingPermissions || { smallRoom: true, largeRoom: false };
    if (permissions.smallRoom && permissions.largeRoom) {
      return 'bg-purple-900/50 text-purple-300 border-purple-700/50';
    } else if (permissions.smallRoom) {
      return 'bg-green-900/50 text-green-300 border-green-700/50';
    } else if (permissions.largeRoom) {
      return 'bg-blue-900/50 text-blue-300 border-blue-700/50';
    } else {
      return 'bg-red-900/50 text-red-300 border-red-700/50';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#f37121] mx-auto mb-4"></div>
          <p className="text-gray-400">Loading Users...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      {/* Background Effects */}
      <div className="fixed inset-0 bg-gradient-to-br from-[#f37121]/10 via-transparent to-[#f37121]/5 blur-3xl pointer-events-none" />
      
      <div className="max-w-7xl mx-auto relative z-10">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
              User Management
            </h1>
            <p className="text-gray-400 mt-2">Manage system users and permissions</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white font-medium py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-orange-400/50"
            >
              Create New User
            </button>
            <Link 
              href="/admin-dashboard"
              className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl border border-blue-500/50 text-center"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="bg-red-900/50 border border-red-700/50 text-red-200 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-900/50 border border-green-700/50 text-green-200 px-4 py-3 rounded-lg mb-6">
            {success}
          </div>
        )}

        {/* Users Table */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-xl overflow-hidden border border-gray-700">
          <div className="px-6 py-4 border-b border-gray-700 bg-gray-800/50">
            <h2 className="text-xl font-semibold text-[#f37121]">All Users ({users.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-700">
              <thead className="bg-gray-800/80">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Username
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Booking Permissions
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-gray-800/50 divide-y divide-gray-700">
                {users.map(user => (
                  <tr key={user._id || user.id} className="hover:bg-gray-700/50 transition-colors duration-200">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-white">
                        {user.fullName}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        user.role === 'admin' 
                          ? 'bg-purple-900/50 text-purple-300 border border-purple-700/50' 
                          : 'bg-blue-900/50 text-blue-300 border border-blue-700/50'
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-300">@{user.username}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getPermissionsColor(user)}`}>
                        {getPermissionsText(user)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => handleEditUser(user)}
                        className="text-[#f37121] hover:text-orange-400 mr-3 transition-colors duration-200"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handlePermissions(user)}
                        className="text-green-400 hover:text-green-300 mr-3 transition-colors duration-200"
                      >
                        Permissions
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user._id || user.id)}
                        className="text-red-400 hover:text-red-300 transition-colors duration-200"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-2xl border border-gray-700 w-full max-w-md">
            <div className="flex justify-between items-center p-6 border-b border-gray-700">
              <h2 className="text-xl font-bold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
                Create New User
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-[#f37121] text-2xl font-bold transition-colors duration-200"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData(prev => ({ ...prev, fullName: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Username</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Role</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value as 'user' | 'admin' }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="border-t border-gray-700 pt-4">
                <h3 className="text-lg font-semibold text-[#f37121] mb-3">Booking Permissions</h3>
                <div className="space-y-3">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.bookingPermissions.smallRoom}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        bookingPermissions: {
                          ...prev.bookingPermissions,
                          smallRoom: e.target.checked
                        }
                      }))}
                      className="w-4 h-4 text-[#f37121] bg-gray-700 border-gray-600 rounded focus:ring-[#f37121] focus:ring-2"
                    />
                    <span className="ml-2 text-sm text-gray-300">Small Room Access</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.bookingPermissions.largeRoom}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        bookingPermissions: {
                          ...prev.bookingPermissions,
                          largeRoom: e.target.checked
                        }
                      }))}
                      className="w-4 h-4 text-[#f37121] bg-gray-700 border-gray-600 rounded focus:ring-[#f37121] focus:ring-2"
                    />
                    <span className="ml-2 text-sm text-gray-300">Large Room Access</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200"
                >
                  Create User
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-2xl border border-gray-700 w-full max-w-md">
            <div className="flex justify-between items-center p-6 border-b border-gray-700">
              <h2 className="text-xl font-bold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
                Edit User
              </h2>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-gray-400 hover:text-[#f37121] text-2xl font-bold transition-colors duration-200"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData(prev => ({ ...prev, fullName: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Username</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">New Password (leave empty to keep current)</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white"
                  placeholder="Enter new password"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Role</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value as 'user' | 'admin' }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#f37121] focus:border-transparent text-white"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200"
                >
                  Update User
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permissions Modal */}
      {showPermissionsModal && selectedUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl shadow-2xl border border-gray-700 w-full max-w-md">
            <div className="flex justify-between items-center p-6 border-b border-gray-700">
              <h2 className="text-xl font-bold bg-gradient-to-r from-[#f37121] to-orange-500 bg-clip-text text-transparent">
                Manage Permissions - {selectedUser.fullName}
              </h2>
              <button
                onClick={() => setShowPermissionsModal(false)}
                className="text-gray-400 hover:text-[#f37121] text-2xl font-bold transition-colors duration-200"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleUpdatePermissions} className="p-6 space-y-4">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-[#f37121] mb-3">Room Booking Permissions</h3>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-gray-700 rounded-lg border border-gray-600">
                    <div>
                      <h4 className="font-medium text-white">Small Room</h4>
                      <p className="text-sm text-gray-400">Up to 10 attendees</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={permissionsData.smallRoom}
                        onChange={(e) => setPermissionsData(prev => ({
                          ...prev,
                          smallRoom: e.target.checked
                        }))}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-gray-700 rounded-lg border border-gray-600">
                    <div>
                      <h4 className="font-medium text-white">Large Room</h4>
                      <p className="text-sm text-gray-400">Up to 30 attendees</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={permissionsData.largeRoom}
                        onChange={(e) => setPermissionsData(prev => ({
                          ...prev,
                          largeRoom: e.target.checked
                        }))}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                  </div>
                </div>

                <div className="bg-gray-700/50 rounded-lg p-3 border border-gray-600">
                  <h4 className="font-medium text-white mb-2">Current Permissions:</h4>
                  <p className="text-sm text-gray-300">
                    {permissionsData.smallRoom && permissionsData.largeRoom 
                      ? 'Can book both Small and Large rooms'
                      : permissionsData.smallRoom 
                      ? 'Can book Small rooms only'
                      : permissionsData.largeRoom
                      ? 'Can book Large rooms only'
                      : 'No room booking access'
                    }
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-gradient-to-r from-[#f37121] to-orange-500 hover:from-[#e5651a] hover:to-orange-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200"
                >
                  Update Permissions
                </button>
                <button
                  type="button"
                  onClick={() => setShowPermissionsModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}