import { useEffect, useState } from 'react';
import { isPageVisible, observePageVisibility } from '../utils/pageVisibility';

export const usePageVisibility = () => {
  const [visible, setVisible] = useState(isPageVisible);
  useEffect(() => observePageVisibility(setVisible), []);
  return visible;
};
