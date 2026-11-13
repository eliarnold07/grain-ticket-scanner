import React, { useId, useState } from 'react';
import { contractMatches, contractName, contractOptionLabel } from './contractNames.js';

export default function ContractPicker({ label, contracts, value, onChange, placeholder = 'Choose a contract', detail }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const selected = contracts.find(contract => contract.id === value);
  const matches = contracts.filter(contract => contractMatches(contract, query));
  const options = selected && !matches.includes(selected) ? [selected, ...matches] : matches;

  return (
    <div className="field contract-picker">
      <label htmlFor={id}>{label}</label>
      {contracts.length > 0 && <input type="search" aria-label={`Search contracts for ${label.toLowerCase()}`}
        placeholder="Search name or contract number" value={query} onChange={event => setQuery(event.target.value)} />}
      <select id={id} value={value} onChange={event => { onChange(event.target.value); setQuery(''); }}>
        <option value="">{placeholder}</option>
        {options.map(contract => (
          <option key={contract.id} value={contract.id}>
            {contractOptionLabel(contract)}{detail ? ` · ${detail(contract)}` : ''}
          </option>
        ))}
      </select>
      {selected && <span className="contract-picked-name">
        <strong>{contractName(selected)}</strong>
        <small>{[selected.display_name && selected.contract_id, selected.buyer].filter(Boolean).join(' · ')}</small>
      </span>}
      {query && matches.length === 0 && <small role="status">No matching contracts.</small>}
    </div>
  );
}
