import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';

/**
 * Whether the signed-in person is an administrator. Used to keep the technical
 * record of a run (its trace, the steps that ran, model and token counts) off
 * the pages a customer reads. False until the answer arrives, and on any error.
 */
export function useIsAdmin(): boolean {
  const { data } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get<{ userId: string; isAdmin: boolean }>('/auth/me').then((r) => r.data),
    staleTime: 60_000,
    retry: false,
  });
  return data?.isAdmin === true;
}
