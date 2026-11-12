/// Role rights shared by every screen, mirroring backend config/roles.js.
/// Each section's team leader (`<x>_team_leader`) holds the rights of its manager (`<x>_manager`);
/// the backend asserts this naming at load time, so the rule needs no list here.
library;

final _teamLeader = RegExp(r'_team_leader$');

/// The role whose rights this role holds: a team leader maps to its section manager, any other role to itself.
String rightsRoleOf(String? role) {
  final r = role ?? '';
  return _teamLeader.hasMatch(r) ? r.replaceFirst(_teamLeader, '_manager') : r;
}

bool isTeamLeader(String? role) => _teamLeader.hasMatch(role ?? '');

/// Does this role pass a role list? Also true when the list names the role whose rights it holds.
bool roleIn(String? role, Iterable<String> list) {
  if (role == null || role.isEmpty) return false;
  return list.contains(role) || list.contains(rightsRoleOf(role));
}
