import { useSyncExternalStore } from 'react';

// The existing management password is only kept in memory for this app session.
let password: string | null = null;
const listeners = new Set<() => void>();

export const getAdminPassword = () => password;

export const setAdminPassword = (value: string | null) => {
  password = value;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const useAdminPassword = () => useSyncExternalStore(subscribe, getAdminPassword, () => null);
