import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Home from './page';

const mockState = vi.hoisted(() => ({
  currentUser: null,
  profile: null,
  departments: [],
  memberships: [],
  profiles: [],
  tasks: [],
  recurringRules: [],
  notifications: [],
  summary: null,
  report: [],
  history: [],
  insertedTasks: [],
  insertedRecurringRules: [],
  updatedTasks: [],
  deletedTasks: [],
  auth: {
    getCurrentUser: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    verifyEmail: vi.fn(),
    sendResetPasswordEmail: vi.fn(),
    exchangeResetPasswordToken: vi.fn(),
    resetPassword: vi.fn(),
    signOut: vi.fn()
  },
  database: {
    rpc: vi.fn(),
    from: vi.fn()
  },
  functions: {
    invoke: vi.fn()
  },
  storage: {
    from: vi.fn()
  },
  setAccessToken: vi.fn(),
  getHttpClient: vi.fn()
}));

vi.mock('@/lib/insforge', () => {
  const STATUSES = [
    ['idea', 'Idea'],
    ['planning', 'Planificacion'],
    ['in_progress', 'En progreso'],
    ['blocked', 'Bloqueado'],
    ['in_review', 'En revision'],
    ['completed', 'Completado'],
    ['archived', 'Archivado']
  ];
  const PRIORITIES = [
    ['high', 'Alta'],
    ['medium', 'Media'],
    ['low', 'Baja']
  ];
  const FREQUENCIES = [
    ['daily', 'Diaria'],
    ['weekly', 'Semanal'],
    ['monthly', 'Mensual'],
    ['custom_interval', 'Personalizado']
  ];

  return {
    FREQUENCIES,
    PRIORITIES,
    STATUSES,
    labelFrom: (options, value) => options.find(([key]) => key === value)?.[1] ?? value,
    insforge: {
      auth: mockState.auth,
      database: mockState.database,
      functions: mockState.functions,
      storage: mockState.storage,
      setAccessToken: mockState.setAccessToken,
      getHttpClient: mockState.getHttpClient
    }
  };
});

function queryResult(data = null, error = null) {
  return Promise.resolve({ data, error });
}

function chainResult(data = null, error = null) {
  const result = { data, error };
  return {
    order: vi.fn(() => chainResult(data, error)),
    limit: vi.fn(() => queryResult(data, error)),
    eq: vi.fn(() => chainResult(data, error)),
    select: vi.fn(() => queryResult(data, error)),
    then: (resolve, reject) => queryResult(data, error).then(resolve, reject)
  };
}

function tableData(table) {
  const datasets = {
    departments: mockState.departments,
    user_department_memberships: mockState.memberships,
    profiles: mockState.profiles,
    tasks: mockState.tasks,
    recurring_task_rules: mockState.recurringRules,
    notifications: mockState.notifications,
    task_comments: [],
    task_attachments: [],
    task_history: mockState.history
  };

  return datasets[table] ?? [];
}

function tableClient(table) {
  return {
    select: vi.fn(() => chainResult(tableData(table))),
    insert: vi.fn((rows) => {
      if (table === 'tasks') mockState.insertedTasks.push(...rows);
      if (table === 'recurring_task_rules') mockState.insertedRecurringRules.push(...rows);
      return {
        select: vi.fn(() => queryResult(rows.map((row, index) => ({ id: `new-${index}`, ...row }))))
      };
    }),
    update: vi.fn((patch) => ({
      eq: vi.fn((field, id) => {
        mockState.updatedTasks.push({ table, field, id, patch });
        return queryResult(null);
      })
    })),
    delete: vi.fn(() => ({
      eq: vi.fn((field, id) => {
        mockState.deletedTasks.push({ table, field, id });
        return queryResult(null);
      })
    }))
  };
}

beforeEach(() => {
  mockState.currentUser = null;
  mockState.profile = null;
  mockState.departments = [];
  mockState.memberships = [];
  mockState.profiles = [];
  mockState.tasks = [];
  mockState.recurringRules = [];
  mockState.notifications = [];
  mockState.summary = null;
  mockState.report = [];
  mockState.history = [];
  mockState.insertedTasks = [];
  mockState.insertedRecurringRules = [];
  mockState.updatedTasks = [];
  mockState.deletedTasks = [];
  window.localStorage.clear();
  window.confirm = vi.fn(() => true);

  vi.clearAllMocks();

  mockState.auth.getCurrentUser.mockImplementation(() => queryResult({ user: mockState.currentUser }));
  mockState.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1' }, accessToken: 'token-1' }, error: null });
  mockState.auth.signOut.mockResolvedValue({ error: null });
  mockState.setAccessToken.mockReturnValue(undefined);
  mockState.getHttpClient.mockReturnValue({
    get: vi.fn(() => Promise.resolve({ user: mockState.currentUser }))
  });
  mockState.database.rpc.mockImplementation((name) => {
    if (name === 'ensure_current_profile') return queryResult(mockState.profile);
    if (name === 'update_own_profile') {
      mockState.profile = { ...mockState.profile, full_name: 'Miguel Actualizado' };
      mockState.profiles = mockState.profiles.map((item) => (item.id === mockState.profile.id ? mockState.profile : item));
      return queryResult(mockState.profile);
    }
    if (name === 'dashboard_summary') return queryResult(mockState.summary);
    if (name === 'task_report') return queryResult(mockState.report);
    return queryResult(null);
  });
  mockState.database.from.mockImplementation((table) => tableClient(table));
  mockState.functions.invoke.mockResolvedValue({ data: { created: [] }, error: null });
  mockState.storage.from.mockReturnValue({
    upload: vi.fn(() => queryResult({ key: 'file-key', url: 'https://files.example/file.txt' }))
  });
});

function seedActiveWorkspace() {
  mockState.currentUser = { id: 'user-1' };
  mockState.profile = {
    id: 'user-1',
    full_name: 'Miguel Mesa',
    email: 'miguel@example.com',
    role: 'admin',
    status: 'active'
  };
  mockState.departments = [
    { id: 'ops', name: 'Operaciones' },
    { id: 'sales', name: 'Ventas' }
  ];
  mockState.profiles = [
    mockState.profile,
    { id: 'user-2', full_name: 'Ana Torres', role: 'user', status: 'active' },
    { id: 'admin-2', full_name: 'Laura Admin', role: 'admin', status: 'active' }
  ];
  mockState.tasks = [
    {
      id: 'task-base-1',
      title: 'Revisar inventario de aceite',
      description: 'Validar existencias',
      department_id: 'ops',
      responsible_id: 'user-2',
      status: 'idea',
      priority: 'high',
      is_recurring: true,
      recurring_rule_id: 'rule-1',
      start_date: '2026-05-20',
      due_date: '2026-06-01'
    },
    {
      id: 'task-1',
      title: 'Revisar inventario de aceite',
      description: 'Validar existencias',
      department_id: 'ops',
      responsible_id: 'user-2',
      status: 'in_progress',
      priority: 'high',
      is_recurring: true,
      recurring_rule_id: 'rule-1',
      start_date: '2026-05-29',
      due_date: '2026-06-10'
    },
    {
      id: 'task-2',
      title: 'Enviar reporte comercial',
      description: 'Ventas semanales',
      department_id: 'sales',
      responsible_id: null,
      status: 'idea',
      priority: 'medium',
      start_date: null,
      due_date: null
    },
    {
      id: 'task-archived',
      title: 'Tarea vieja archivada',
      description: 'Sale de la papelera pronto',
      department_id: 'ops',
      responsible_id: 'user-2',
      status: 'archived',
      priority: 'low',
      is_recurring: false,
      archived_at: '2026-05-23T12:00:00.000Z'
    }
  ];
  mockState.summary = {
    total_tasks: 2,
    pending_tasks: 1,
    in_progress_tasks: 1,
    completed_tasks: 0,
    overdue_tasks: 0,
    high_priority_tasks: 1
  };
  mockState.report = [
    { department_id: 'ops', department_name: 'Operaciones', status: 'in_progress', priority: 'high', total: 1 }
  ];
  mockState.recurringRules = [
    {
      id: 'rule-1',
      task_base_id: 'task-base-1',
      frequency: 'weekly',
      weekday: 2,
      weekdays: [2, 5],
      month_day: null,
      interval_days: null,
      is_active: true,
      next_run_at: '2026-05-29T06:00:00.000Z'
    }
  ];
  mockState.notifications = [
    {
      id: 'notification-1',
      type: 'comment_added',
      message: 'Ana Torres ha comentado tu tarea: Revisar inventario de aceite',
      is_read: false,
      task_id: 'task-1',
      created_at: '2026-05-23T12:10:00.000Z'
    }
  ];
  mockState.history = [
    {
      id: 'history-1',
      action: 'task_updated',
      user_id: 'user-1',
      previous_value: { status: 'in_progress', priority: 'high' },
      new_value: { status: 'blocked', priority: 'low' },
      created_at: '2026-05-23T12:00:00.000Z'
    },
    {
      id: 'history-2',
      action: 'task_created',
      user_id: 'user-1',
      previous_value: null,
      new_value: { title: 'Revisar inventario de aceite' },
      created_at: '2026-05-22T12:00:00.000Z'
    }
  ];
}

function seedUserWorkspace() {
  seedActiveWorkspace();
  mockState.currentUser = { id: 'user-2' };
  mockState.profile = {
    id: 'user-2',
    full_name: 'Ana Torres',
    email: 'ana@example.com',
    role: 'user',
    status: 'active'
  };
  mockState.profiles = [
    { id: 'admin-1', full_name: 'Miguel Admin', role: 'admin', status: 'active' },
    mockState.profile,
    { id: 'user-3', full_name: 'Carlos Ruiz', role: 'user', status: 'active' }
  ];
}

describe('Nomada Tasks page', () => {
  it('shows the sign-in flow when there is no active session', async () => {
    render(<Home />);

    expect(await screen.findByRole('heading', { name: 'Acceso a tareas' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Correo')).toBeRequired();
    expect(screen.getByPlaceholderText('Contrasena')).toBeRequired();
    expect(screen.getByRole('button', { name: 'Iniciar sesion' })).toBeEnabled();
  });

  it('restores a stored session after reloading the page', async () => {
    seedActiveWorkspace();
    const storedUser = { id: 'user-1' };
    mockState.currentUser = null;
    window.localStorage.setItem('nomada_tasks_auth_session', JSON.stringify({
      accessToken: 'stored-token',
      user: storedUser
    }));
    mockState.getHttpClient.mockReturnValue({
      get: vi.fn(() => Promise.resolve({ user: storedUser }))
    });

    render(<Home />);

    expect(await screen.findByRole('heading', { name: 'Nomada Tasks' })).toBeInTheDocument();
    expect(mockState.setAccessToken).toHaveBeenCalledWith('stored-token');
    expect(screen.getAllByText('Miguel Mesa').length).toBeGreaterThan(0);
  });

  it('loads an active workspace and filters visible tasks', async () => {
    seedActiveWorkspace();

    render(<Home />);

    expect(await screen.findByRole('heading', { name: 'Nomada Tasks' })).toBeInTheDocument();
    expect(screen.getAllByText('Miguel Mesa').length).toBeGreaterThan(0);
    expect(screen.getByText('Revisar inventario de aceite')).toBeInTheDocument();
    expect(screen.getByText('Enviar reporte comercial')).toBeInTheDocument();
    expect(screen.getByText('Alta prioridad')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tienes 1 tarea repetitiva activa/ }));
    expect(screen.getByRole('heading', { name: 'Tareas repetitivas' })).toBeInTheDocument();
    expect(screen.getByText('Se crea martes y viernes')).toBeInTheDocument();
    expect(screen.getByText(/Se te asignara el dia viernes 29 de mayo/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Cerrar tareas repetitivas'));
    expect(screen.getByRole('columnheader', { name: 'Inicio' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Fin' })).toBeInTheDocument();
    expect(screen.getByText('2026-05-29')).toBeInTheDocument();
    expect(screen.getByText('2026-06-10')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar'), { target: { value: 'aceite' } });

    expect(screen.getByText('Revisar inventario de aceite')).toBeInTheDocument();
    expect(screen.queryByText('Enviar reporte comercial')).not.toBeInTheDocument();
  });

  it('creates a recurring task through the task form', async () => {
    seedActiveWorkspace();

    render(<Home />);

    await screen.findByRole('heading', { name: 'Crear tarea' });

    fireEvent.change(screen.getByPlaceholderText('Nombre de tarea'), {
      target: { value: 'Auditar compras recurrentes' }
    });
    fireEvent.change(screen.getByPlaceholderText('Descripcion opcional'), {
      target: { value: 'Seguimiento semanal de ordenes' }
    });
    fireEvent.click(screen.getByLabelText('Tarea repetitiva'));
    expect(screen.getByText('Repetir los dias')).toBeInTheDocument();
    expect(screen.getByText('Se repetira martes.')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Viernes'));
    expect(screen.getByText('Se repetira martes y viernes.')).toBeInTheDocument();
    expect(screen.getByText('Proximas tareas:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Guardar tarea/ }));

    await waitFor(() => {
      expect(mockState.insertedTasks).toHaveLength(1);
      expect(mockState.insertedRecurringRules).toHaveLength(1);
    });

    expect(mockState.insertedTasks[0]).toMatchObject({
      title: 'Auditar compras recurrentes',
      description: 'Seguimiento semanal de ordenes',
      department_id: 'ops',
      status: 'idea',
      priority: 'medium',
      is_recurring: true
    });
    expect(mockState.insertedRecurringRules[0]).toMatchObject({
      task_base_id: 'new-0',
      frequency: 'weekly',
      weekday: 2,
      weekdays: [2, 5],
      scheduled_time: '06:00'
    });
    expect(within(screen.getByRole('main')).getByText(/Tarea repetitiva creada. Se te asignara el dia/)).toBeInTheDocument();
  });

  it('does not let regular users assign tasks to admins', async () => {
    seedUserWorkspace();

    render(<Home />);

    const taskForm = await screen.findByRole('heading', { name: 'Crear tarea' });
    const form = taskForm.closest('section');

    expect(within(form).queryByRole('option', { name: 'Miguel Admin' })).not.toBeInTheDocument();
    expect(within(form).getByRole('option', { name: 'Carlos Ruiz' })).toBeInTheDocument();
  });

  it('updates the displayed profile name from settings', async () => {
    seedActiveWorkspace();

    render(<Home />);

    await screen.findByRole('heading', { name: 'Nomada Tasks' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir ajustes' }));
    fireEvent.change(screen.getByPlaceholderText('Nombre y apellido'), {
      target: { value: 'Miguel Actualizado' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Guardar perfil/ }));

    await waitFor(() => {
      expect(within(screen.getByRole('main')).getByText('Perfil actualizado.')).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Miguel Actualizado/).length).toBeGreaterThan(0);
  });

  it('hides department change requests for admins', async () => {
    seedActiveWorkspace();

    render(<Home />);

    await screen.findByRole('heading', { name: 'Nomada Tasks' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir ajustes' }));

    expect(screen.queryByRole('heading', { name: 'Cambio de departamento' })).not.toBeInTheDocument();
  });

  it('lets users change task status and priority from the board', async () => {
    seedActiveWorkspace();

    render(<Home />);

    await screen.findByRole('heading', { name: 'Tablero de tareas' });

    fireEvent.change(screen.getByLabelText('Cambiar estado de Revisar inventario de aceite'), {
      target: { value: 'blocked' }
    });
    fireEvent.change(screen.getByLabelText('Cambiar prioridad de Revisar inventario de aceite'), {
      target: { value: 'low' }
    });

    await waitFor(() => {
      expect(mockState.updatedTasks).toEqual([
        { table: 'tasks', field: 'id', id: 'task-1', patch: { status: 'blocked' } },
        { table: 'tasks', field: 'id', id: 'task-1', patch: { priority: 'low' } }
      ]);
    });
  });

  it('explains the next automatic occurrence when completing a recurring task', async () => {
    seedActiveWorkspace();

    render(<Home />);

    await screen.findByRole('heading', { name: 'Tablero de tareas' });

    const recurringRow = screen.getByRole('button', { name: /Revisar inventario de aceite/ }).closest('tr');

    fireEvent.click(within(recurringRow).getByLabelText('Completar tarea'));

    await waitFor(() => {
      expect(within(screen.getByRole('main')).getByText(/Tarea completada. Se agregara automaticamente el viernes 29 de mayo/)).toBeInTheDocument();
    });
    expect(mockState.updatedTasks.at(-1)).toMatchObject({
      table: 'tasks',
      field: 'id',
      id: 'task-1',
      patch: { status: 'completed' }
    });
  });

  it('lets admins permanently delete archived tasks from trash', async () => {
    seedActiveWorkspace();

    render(<Home />);

    await screen.findByRole('heading', { name: 'Tablero de tareas' });
    fireEvent.click(screen.getByRole('button', { name: /1 tarea archivada/ }));

    expect(screen.getByRole('heading', { name: 'Tareas archivadas' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Borrar para siempre/ }));

    await waitFor(() => {
      expect(mockState.deletedTasks).toEqual([
        { table: 'tasks', field: 'id', id: 'task-archived' }
      ]);
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Tarea vieja archivada'));
  });

  it('hides permanent delete actions in trash for non-admin users', async () => {
    seedUserWorkspace();

    render(<Home />);

    await screen.findByRole('heading', { name: 'Tablero de tareas' });
    fireEvent.click(screen.getByRole('button', { name: /1 tarea archivada/ }));

    expect(screen.getByRole('heading', { name: 'Tareas archivadas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Borrar para siempre/ })).not.toBeInTheDocument();
  });

  it('closes the task detail modal from the close button and backdrop', async () => {
    seedActiveWorkspace();

    render(<Home />);

    fireEvent.click(await screen.findByRole('button', { name: /^Revisar inventario de aceite$/ }));
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Revisar inventario de aceite$/ }));
    const closeButton = await screen.findByRole('button', { name: 'Cerrar' });
    fireEvent.click(closeButton.closest('.fixed'));

    expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument();
  });

  it('shows task history in Spanish', async () => {
    seedActiveWorkspace();

    render(<Home />);

    fireEvent.click(await screen.findByRole('button', { name: /^Revisar inventario de aceite$/ }));

    expect(await screen.findByText(/Miguel Mesa actualizo la tarea: Estado: En progreso -> Bloqueado, Prioridad: Alta -> Baja/)).toBeInTheDocument();
    expect(screen.getByText(/Miguel Mesa creo la tarea/)).toBeInTheDocument();
    expect(screen.queryByText(/task_updated/)).not.toBeInTheDocument();
  });

  it('labels task title and empty description in the detail modal', async () => {
    seedActiveWorkspace();
    mockState.tasks.find((task) => task.id === 'task-1').description = '';

    render(<Home />);

    fireEvent.click(await screen.findByRole('button', { name: /^Revisar inventario de aceite$/ }));

    expect(screen.getByText('Titulo tarea')).toBeInTheDocument();
    expect(screen.getByText('Descripcion tarea')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Haz click para agregar descripcion' })).toBeInTheDocument();
  });

  it('shows the actor name in task notifications', async () => {
    seedActiveWorkspace();

    render(<Home />);

    fireEvent.click(await screen.findByRole('button', { name: 'Abrir notificaciones' }));

    expect(screen.getByText('Ana Torres ha comentado tu tarea: Revisar inventario de aceite')).toBeInTheDocument();
  });
});
