import { createClient } from 'npm:@insforge/sdk';

/**
 * Edge Function para generar tareas recurrentes.
 *
 * Valida la solicitud, comprueba permisos cuando se ejecuta manualmente
 * y llama al RPC generate_recurring_tasks definido en la base de datos.
 */

const allowedOrigin = Deno.env.get('APP_ORIGIN') ?? '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Cron-Secret'
};

async function generateRecurringTasks(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const userToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
    const cronSecret = Deno.env.get('RECURRING_TASKS_CRON_SECRET');
    const isTrustedCron = Boolean(cronSecret && req.headers.get('X-Cron-Secret') === cronSecret);

    if (!userToken && !isTrustedCron) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const client = createClient({
      baseUrl: Deno.env.get('INSFORGE_BASE_URL'),
      edgeFunctionToken: userToken && !isTrustedCron ? userToken : undefined,
      anonKey: isTrustedCron ? Deno.env.get('API_KEY') : undefined
    });

    if (!isTrustedCron) {
      const { data: userData, error: userError } = await client.auth.getCurrentUser();
      if (userError || !userData?.user?.id) {
        return json({ error: 'Unauthorized' }, 401);
      }

      const { data: profile, error: profileError } = await client.database
        .from('profiles')
        .select('role,status')
        .eq('id', userData.user.id)
        .single();

      if (profileError || profile?.role !== 'admin' || profile?.status !== 'active') {
        return json({ error: 'Only active admins can run recurring generation manually' }, 403);
      }
    }

    const { data, error } = await client.database.rpc('generate_recurring_tasks');
    if (error) {
      return json({ error: error.message ?? 'Failed to generate recurring tasks' }, 500);
    }

    return json({ created: data ?? [] }, 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

export default generateRecurringTasks;
