/**
 * Employee engagement type: sponsored by us, or freelance.
 * A freelancer has no contract: someone not on our sponsorship has no contract with us, so contract data for him is not 'missing' but 'not required'. This matters because the 'required' column is the HR team's work list; putting 67 names in it sends them chasing paper that does not exist.
 * It can be flipped at any time: someone moved to our sponsorship has his contract data required again, from the contracts page or his file, with one rule in both places.
 */
const SPONSORED = 'sponsored';
const FREELANCER = 'freelancer';

// Contract fields that make no sense without sponsorship.
const CONTRACT_FIELDS = [
  'contractStatusText', 'qiwaContractNumber', 'contractOccupation',
  'contractStartDate', 'contractEndDate', 'annualLeaveDays', 'probationMonths',
];

const isFreelancerType = (v) => String(v || '').trim() === FREELANCER;

/**
 * Builds what is written on the employee when his type changes.
 * Returns a ready `$set`: the type, its logical mirror, and the contract field states. It does not touch contract values: someone who had a contract and became freelance keeps his dates; what changes is that they are no longer required.
 */
function applyEmploymentType(type) {
  const t = String(type || '').trim();
  const free = isFreelancerType(t);
  const set = { employmentType: t, isFreelancer: free };
  for (const f of CONTRACT_FIELDS) {
    // 'Not required' for freelance; the flag is lifted on return to sponsorship so the state is read from the value like everyone else.
    set[`fieldStatus.${f}Status`] = free ? 'not_required' : '';
  }
  return set;
}

module.exports = { SPONSORED, FREELANCER, CONTRACT_FIELDS, isFreelancerType, applyEmploymentType };
