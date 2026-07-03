'use client';

/**
 * LoginFormContainer — interactive leaf for the login form.
 *
 * Why 'use client': needs useActionState (React 19) to capture both the
 * ActionResult returned by loginAction on failure and the isPending flag.
 * On success, loginAction calls redirect('/') server-side before returning,
 * so no client-side navigation is required.
 *
 * Minimum client surface (server-first-react §4):
 *  - Wraps loginAction in the useActionState signature contract.
 *  - useActionState returns [state, formAction, isPending]; isPending is
 *    the third tuple element — true while the server action is in flight.
 *  - Returns a single _components/ invocation (LoginForm) directly,
 *    passing formAction, state, and isPending as props.
 */

import { useActionState } from 'react';
import { loginAction } from '@/app/login/actions';
import { LoginForm } from '@/app/login/_components/LoginForm/LoginForm';

type ActionResult =
  | { success: true; value?: void }
  | { success: false; code: string; message: string; details?: unknown };

export function LoginFormContainer() {
  // useActionState returns [state, formAction, isPending] in React 19.
  // isPending is true while the server action is in flight — no useFormStatus required.
  const [state, formAction, isPending] = useActionState(
    async (_prev: ActionResult | null, fd: FormData) => loginAction(fd),
    null,
  );

  return <LoginForm formAction={formAction} state={state} pending={isPending} />;
}
