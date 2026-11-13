export function contractName(contract) {
  return contract?.display_name?.trim() || contract?.contract_id || 'Unnamed contract';
}

export function contractMatches(contract, query) {
  const term = String(query ?? '').trim().toLowerCase();
  return [contract.display_name, contract.contract_id, contract.buyer]
    .some(value => String(value ?? '').toLowerCase().includes(term));
}

export function contractOptionLabel(contract) {
  return [contractName(contract), contract.display_name?.trim() && contract.contract_id, contract.buyer]
    .filter(Boolean).join(' · ');
}

export function assignedContractIds(ticket) {
  return [...new Set((Array.isArray(ticket.assignments) ? ticket.assignments : [])
    .filter(assignment => assignment?.type === 'CONTRACT' && assignment.contract_id)
    .map(assignment => assignment.contract_id))];
}

export function contractNamePatch(input) {
  if (!Object.hasOwn(input, 'display_name')) return {};
  const value = input.display_name;
  if (value !== null && typeof value !== 'string') throw Error('Enter a contract name.');
  const normalized = value?.trim().replace(/\s+/g, ' ') || null;
  if (normalized && [...normalized].length > 100) throw Error('Contract names are limited to 100 characters.');
  return { display_name: normalized };
}
