import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useAuth } from '@/stores/auth';
import { ada } from '@/test/fixtures';
import { renderRoutes } from '@/test/render';
import { api, server } from '@/test/server';
import { LaunchPage } from './launch-page';

const routes = [
  { path: '/login', element: <LaunchPage mode="login" /> },
  { path: '/register', element: <LaunchPage mode="register" /> },
  { path: '/w/:id', element: <p>Inside the workspace</p> },
  { path: '/', element: <p>Home</p> },
];

describe('LaunchPage', () => {
  it('validates on the client before calling the API', async () => {
    renderRoutes(routes, '/login');
    await userEvent.click(screen.getByRole('button', { name: /launch/i }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
  });

  it('shows the server’s 401 as a form alert', async () => {
    server.use(
      http.post(api('/auth/login'), () =>
        HttpResponse.json(
          { type: 'x', title: 'Unauthorized', status: 401, detail: 'Invalid email or password' },
          { status: 401 },
        ),
      ),
    );
    renderRoutes(routes, '/login');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@acme.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /launch/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('maps 422 field errors from register onto their inputs', async () => {
    server.use(
      http.post(api('/auth/register'), () =>
        HttpResponse.json(
          {
            type: 'x',
            title: 'Validation failed',
            status: 422,
            errors: [{ field: 'email', message: 'Already registered' }],
          },
          { status: 422 },
        ),
      ),
    );
    renderRoutes(routes, '/register');
    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@acme.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText('Already registered')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('stores the session and follows a same-site ?next=', async () => {
    server.use(
      http.post(api('/auth/login'), () =>
        HttpResponse.json({
          accessToken: 'tok',
          tokenType: 'Bearer',
          expiresIn: 900,
          user: { ...ada, createdAt: '' },
        }),
      ),
    );
    const { router } = renderRoutes(routes, '/login?next=%2Fw%2Fw1');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@acme.dev');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: /launch/i }));
    expect(await screen.findByText('Inside the workspace')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/w/w1');
    expect(useAuth.getState().accessToken).toBe('tok');
  });

  it('ignores an off-site ?next= (open redirect)', async () => {
    useAuth.setState({ accessToken: 'tok' });
    const { router } = renderRoutes(routes, '/login?next=%2F%2Fevil.example');
    expect(await screen.findByText('Home')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('toggles the password between hidden and shown', async () => {
    renderRoutes(routes, '/login');
    const password = screen.getByLabelText('Password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(toggle);
    expect(password).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(toggle);
    expect(password).toHaveAttribute('type', 'password');
  });
});
