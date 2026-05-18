'use client';

/**
 * Pagina principal de Nomada Tasks.
 *
 * Este archivo contiene autenticacion, carga de datos, gestion de tareas,
 * notificaciones, comentarios, archivos adjuntos y paneles de administracion.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Bell,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardList,
  Loader2,
  LogOut,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck
} from 'lucide-react';
import { FREQUENCIES, PRIORITIES, STATUSES, insforge, labelFrom } from '@/lib/insforge';

// Valores iniciales del formulario para crear una tarea nueva.
const emptyTask = {
  title: '',
  description: '',
  department_id: '',
  responsible_id: '',
  status: 'idea',
  priority: 'medium',
  start_date: '',
  due_date: '',
  repeat: false,
  frequency: 'weekly',
  weekday: '2'
};

export default function Home() {
  // Estado de autenticacion, carga general y mensajes para el usuario.
  const [authMode, setAuthMode] = useState('signin');
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // Datos principales que llegan desde InsForge.
  const [departments, setDepartments] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [summary, setSummary] = useState(null);
  const [report, setReport] = useState([]);

  // Datos del detalle de la tarea seleccionada.
  const [selectedTask, setSelectedTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [history, setHistory] = useState([]);

  // Formularios y filtros usados por la interfaz.
  const [taskForm, setTaskForm] = useState(emptyTask);
  const [filters, setFilters] = useState({ search: '', status: '', department: '' });
  const [credentials, setCredentials] = useState({
    name: '',
    email: '',
    password: '',
    code: '',
    newPassword: ''
  });
  const [adminForm, setAdminForm] = useState({ userId: '', role: 'user', departments: [], leadDepartments: [] });

  // Banderas y listas derivadas para simplificar condiciones en la UI.
  const isAdmin = profile?.role === 'admin' && profile?.status === 'active';
  const activeProfiles = profiles.filter((item) => item.status === 'active');
  // Diccionarios por id para encontrar departamentos y perfiles rapidamente.
  const departmentById = useMemo(
    () => Object.fromEntries(departments.map((department) => [department.id, department])),
    [departments]
  );
  const profileById = useMemo(
    () => Object.fromEntries(profiles.map((item) => [item.id, item])),
    [profiles]
  );

  // Lista de tareas filtrada por busqueda, estado y departamento.
  const visibleTasks = tasks.filter((task) => {
    const text = `${task.title} ${task.description ?? ''}`.toLowerCase();
    return (
      (!filters.search || text.includes(filters.search.toLowerCase())) &&
      (!filters.status || task.status === filters.status) &&
      (!filters.department || task.department_id === filters.department)
    );
  });

  // Al montar la pagina, revisa si ya hay sesion activa y carga el workspace.
  useEffect(() => {
    hydrate();
  }, []);

  // Carga inicial: obtiene el usuario actual y, si existe, trae su perfil y datos.
  async function hydrate() {
    setLoading(true);
    const { data } = await insforge.auth.getCurrentUser();
    const currentUser = data?.user ?? null;
    setUser(currentUser);
    if (currentUser) {
      await ensureProfile(credentials.name);
      await loadWorkspace();
    }
    setLoading(false);
  }

  // Crea o actualiza el perfil del usuario actual en la base de datos.
  async function ensureProfile(name) {
    const { data, error } = await insforge.database.rpc('ensure_current_profile', {
      profile_full_name: name || null
    });
    if (error) {
      setMessage(error.message ?? 'No se pudo preparar el perfil.');
      return null;
    }
    setProfile(data);
    return data;
  }

  // Carga en paralelo departamentos, perfiles, tareas, notificaciones y reportes.
  async function loadWorkspace() {
    const [
      departmentResult,
      membershipResult,
      profileResult,
      taskResult,
      notificationResult,
      summaryResult,
      reportResult
    ] = await Promise.all([
      insforge.database.from('departments').select('*').order('name'),
      insforge.database.from('user_department_memberships').select('*'),
      insforge.database.from('profiles').select('*').order('created_at', { ascending: false }),
      insforge.database.from('tasks').select('*').order('created_at', { ascending: false }),
      insforge.database.from('notifications').select('*').order('created_at', { ascending: false }).limit(30),
      insforge.database.rpc('dashboard_summary'),
      insforge.database.rpc('task_report')
    ]);

    setDepartments(departmentResult.data ?? []);
    setMemberships(membershipResult.data ?? []);
    setProfiles(profileResult.data ?? []);
    setTasks(taskResult.data ?? []);
    setNotifications(notificationResult.data ?? []);
    setSummary(Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data);
    setReport(reportResult.data ?? []);

    if (!taskForm.department_id && departmentResult.data?.[0]?.id) {
      setTaskForm((current) => ({ ...current, department_id: departmentResult.data[0].id }));
    }
  }

  // Inicia sesion con correo y contrasena.
  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const { data, error } = await insforge.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password
    });
    if (error) {
      setMessage(error.message ?? 'No se pudo iniciar sesion.');
    } else {
      setUser(data.user);
      await ensureProfile(credentials.name);
      await loadWorkspace();
    }
    setBusy(false);
  }

  // Registra un usuario nuevo y, si hace falta, lo manda a verificacion por correo.
  async function signUp(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const { data, error } = await insforge.auth.signUp({
      email: credentials.email,
      password: credentials.password,
      name: credentials.name,
      redirectTo: window.location.origin
    });
    if (error) {
      setMessage(error.message ?? 'No se pudo crear la cuenta.');
    } else if (data?.requireEmailVerification) {
      setAuthMode('verify');
      setMessage('Revisa tu correo y escribe el codigo de verificacion.');
    } else {
      setUser(data.user);
      await ensureProfile(credentials.name);
      await loadWorkspace();
    }
    setBusy(false);
  }

  // Verifica el codigo enviado por correo despues del registro.
  async function verifyEmail(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const { data, error } = await insforge.auth.verifyEmail({
      email: credentials.email,
      otp: credentials.code
    });
    if (error) {
      setMessage(error.message ?? 'No se pudo verificar el correo.');
    } else {
      setUser(data.user);
      await ensureProfile(credentials.name);
      await loadWorkspace();
    }
    setBusy(false);
  }

  // Envia el codigo de recuperacion de contrasena al correo del usuario.
  async function sendReset(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const { error } = await insforge.auth.sendResetPasswordEmail({
      email: credentials.email,
      redirectTo: `${window.location.origin}/reset-password`
    });
    setMessage(error ? error.message : 'Codigo de recuperacion enviado.');
    if (!error) setAuthMode('reset-code');
    setBusy(false);
  }

  // Cambia la contrasena usando el codigo de recuperacion.
  async function resetPassword(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const exchange = await insforge.auth.exchangeResetPasswordToken({
      email: credentials.email,
      code: credentials.code
    });
    if (exchange.error) {
      setMessage(exchange.error.message ?? 'Codigo invalido.');
      setBusy(false);
      return;
    }
    const { error } = await insforge.auth.resetPassword({
      newPassword: credentials.newPassword,
      otp: exchange.data.token
    });
    setMessage(error ? error.message : 'Contrasena actualizada. Ya puedes iniciar sesion.');
    if (!error) setAuthMode('signin');
    setBusy(false);
  }

  // Cierra la sesion y limpia datos sensibles de la pantalla.
  async function signOut() {
    await insforge.auth.signOut();
    setUser(null);
    setProfile(null);
    setTasks([]);
    setNotifications([]);
    setSelectedTask(null);
  }

  // Crea una tarea y, si es recurrente, registra su regla de repeticion.
  async function createTask(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    const payload = {
      title: taskForm.title,
      description: taskForm.description || null,
      department_id: taskForm.department_id,
      responsible_id: taskForm.responsible_id || null,
      status: taskForm.status,
      priority: taskForm.priority,
      start_date: taskForm.start_date || null,
      due_date: taskForm.due_date || null,
      is_recurring: taskForm.repeat
    };

    const { data, error } = await insforge.database.from('tasks').insert([payload]).select();
    if (error) {
      setMessage(error.message ?? 'No se pudo crear la tarea.');
      setBusy(false);
      return;
    }

    const newTask = data?.[0];
    if (newTask && taskForm.repeat) {
      const nextRunAt = new Date(`${taskForm.start_date || new Date().toISOString().slice(0, 10)}T06:00:00`);
      await insforge.database.from('recurring_task_rules').insert([
        {
          task_base_id: newTask.id,
          frequency: taskForm.frequency,
          weekday: taskForm.frequency === 'specific_weekday' ? Number(taskForm.weekday) : null,
          scheduled_time: '06:00',
          start_date: taskForm.start_date || new Date().toISOString().slice(0, 10),
          next_run_at: nextRunAt.toISOString()
        }
      ]);
    }

    setTaskForm((current) => ({ ...emptyTask, department_id: current.department_id }));
    await loadWorkspace();
    setMessage('Tarea creada correctamente.');
    setBusy(false);
  }

  // Actualiza campos puntuales de una tarea, por ejemplo estado o archivado.
  async function updateTask(task, patch) {
    setBusy(true);
    const { error } = await insforge.database.from('tasks').update(patch).eq('id', task.id);
    setMessage(error ? error.message : 'Tarea actualizada.');
    await loadWorkspace();
    if (selectedTask?.id === task.id) {
      await openTask({ ...task, ...patch });
    }
    setBusy(false);
  }

  // Abre el detalle de una tarea y carga comentarios, adjuntos e historial.
  async function openTask(task) {
    setSelectedTask(task);
    const [commentResult, attachmentResult, historyResult] = await Promise.all([
      insforge.database.from('task_comments').select('*').eq('task_id', task.id).order('created_at', { ascending: false }),
      insforge.database.from('task_attachments').select('*').eq('task_id', task.id).order('uploaded_at', { ascending: false }),
      insforge.database.from('task_history').select('*').eq('task_id', task.id).order('created_at', { ascending: false })
    ]);
    setComments(commentResult.data ?? []);
    setAttachments(attachmentResult.data ?? []);
    setHistory(historyResult.data ?? []);
  }

  // Agrega un comentario a la tarea seleccionada.
  async function addComment(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const comment = form.get('comment')?.toString();
    if (!comment || !selectedTask) return;

    const { error } = await insforge.database.from('task_comments').insert([
      { task_id: selectedTask.id, comment }
    ]);
    setMessage(error ? error.message : 'Comentario agregado.');
    event.currentTarget.reset();
    await openTask(selectedTask);
    await loadWorkspace();
  }

  // Sube un archivo al storage y registra el adjunto en la base de datos.
  async function uploadAttachment(event) {
    const file = event.target.files?.[0];
    if (!file || !selectedTask) return;
    setBusy(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const key = `tasks/${selectedTask.id}/${Date.now()}-${safeName}`;
    const upload = await insforge.storage.from('task-attachments').upload(key, file);
    if (upload.error) {
      setMessage(upload.error.message ?? 'No se pudo subir el archivo.');
      setBusy(false);
      return;
    }

    const { error } = await insforge.database.from('task_attachments').insert([
      {
        task_id: selectedTask.id,
        file_name: file.name,
        storage_key: upload.data.key,
        file_url: upload.data.url,
        file_type: file.type || 'archivo',
        file_size: file.size
      }
    ]);
    setMessage(error ? error.message : 'Archivo adjuntado.');
    event.target.value = '';
    await openTask(selectedTask);
    await loadWorkspace();
    setBusy(false);
  }

  // Permite a un administrador aprobar usuarios y asignarles departamentos.
  async function approveUser(event) {
    event.preventDefault();
    setBusy(true);
    const { error } = await insforge.database.rpc('approve_user', {
      target_user_id: adminForm.userId,
      target_role: adminForm.role,
      department_ids: adminForm.departments,
      lead_department_ids: adminForm.leadDepartments
    });
    setMessage(error ? error.message : 'Usuario aprobado/actualizado.');
    await loadWorkspace();
    setBusy(false);
  }

  // Marca una notificacion como leida.
  async function markNotificationRead(notification) {
    await insforge.database
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', notification.id);
    await loadWorkspace();
  }

  // Ejecuta manualmente la funcion que genera tareas recurrentes.
  async function runRecurring() {
    setBusy(true);
    const { data, error } = await insforge.functions.invoke('generate-recurring-tasks', { body: {} });
    setMessage(error ? error.message : `Tareas recurrentes creadas: ${data?.created?.length ?? 0}`);
    await loadWorkspace();
    setBusy(false);
  }

  // Estado visual mientras se valida la sesion inicial.
  if (loading) {
    return <FullScreenLoading />;
  }

  // Si no hay usuario autenticado, muestra el flujo de login/registro.
  if (!user) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        credentials={credentials}
        setCredentials={setCredentials}
        signIn={signIn}
        signUp={signUp}
        verifyEmail={verifyEmail}
        sendReset={sendReset}
        resetPassword={resetPassword}
        busy={busy}
        message={message}
      />
    );
  }

  // Si el usuario existe pero aun no fue aprobado, muestra pantalla de espera.
  if (profile?.status !== 'active' || profile?.role === 'pending') {
    return <PendingScreen profile={profile} signOut={signOut} message={message} />;
  }

  // Vista principal para usuarios activos: tablero, detalle, reportes y admin.
  return (
    <main className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-yellow-600">Nomada Moto Partes</p>
            <h1 className="text-2xl font-bold text-zinc-950">Validacion Backend Tasks</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-zinc-100 px-3 py-2 text-sm">
              {profile?.full_name} · {profile?.role}
            </span>
            {isAdmin ? (
              <button className="btn btn-soft" onClick={runRecurring} disabled={busy}>
                <CalendarClock size={16} /> Ejecutar recurrentes
              </button>
            ) : null}
            <button className="btn btn-dark" onClick={signOut}>
              <LogOut size={16} /> Salir
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          {message ? <Notice>{message}</Notice> : null}
          <SummaryPanel summary={summary} />
          <TaskCreator
            taskForm={taskForm}
            setTaskForm={setTaskForm}
            departments={departments}
            activeProfiles={activeProfiles}
            createTask={createTask}
            busy={busy}
          />
          <TaskBoard
            tasks={visibleTasks}
            filters={filters}
            setFilters={setFilters}
            departments={departments}
            departmentById={departmentById}
            profileById={profileById}
            openTask={openTask}
            updateTask={updateTask}
            busy={busy}
          />
          <ReportPanel report={report} />
        </section>

        <aside className="space-y-4">
          <NotificationsPanel notifications={notifications} markRead={markNotificationRead} />
          {selectedTask ? (
            <TaskDetail
              task={selectedTask}
              comments={comments}
              attachments={attachments}
              history={history}
              profileById={profileById}
              addComment={addComment}
              uploadAttachment={uploadAttachment}
              busy={busy}
            />
          ) : (
            <EmptyDetail />
          )}
          {isAdmin ? (
            <AdminPanel
              profiles={profiles}
              departments={departments}
              memberships={memberships}
              adminForm={adminForm}
              setAdminForm={setAdminForm}
              approveUser={approveUser}
              busy={busy}
            />
          ) : null}
        </aside>
      </div>
    </main>
  );
}

// Pantalla de autenticacion: login, registro, verificacion y recuperacion.
function AuthScreen(props) {
  const {
    mode,
    setMode,
    credentials,
    setCredentials,
    signIn,
    signUp,
    verifyEmail,
    sendReset,
    resetPassword,
    busy,
    message
  } = props;

  const formHandler =
    mode === 'signup' ? signUp : mode === 'verify' ? verifyEmail : mode === 'reset' ? sendReset : mode === 'reset-code' ? resetPassword : signIn;

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 px-4 py-8">
      <section className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-wide text-yellow-600">Nomada Moto Partes</p>
        <h1 className="mt-1 text-2xl font-bold">Acceso a tareas</h1>
        <p className="mt-2 text-sm text-zinc-600">App temporal para validar InsForge, roles, tareas y permisos.</p>

        {message ? <Notice>{message}</Notice> : null}

        <form className="mt-5 space-y-3" onSubmit={formHandler}>
          {mode === 'signup' ? (
            <input className="field" placeholder="Nombre completo" value={credentials.name} onChange={(e) => setCredentials({ ...credentials, name: e.target.value })} required />
          ) : null}
          <input className="field" placeholder="Correo" type="email" value={credentials.email} onChange={(e) => setCredentials({ ...credentials, email: e.target.value })} required />
          {mode === 'signin' || mode === 'signup' ? (
            <input className="field" placeholder="Contrasena" type="password" value={credentials.password} onChange={(e) => setCredentials({ ...credentials, password: e.target.value })} required />
          ) : null}
          {mode === 'verify' || mode === 'reset-code' ? (
            <input className="field" placeholder="Codigo recibido por correo" value={credentials.code} onChange={(e) => setCredentials({ ...credentials, code: e.target.value })} required />
          ) : null}
          {mode === 'reset-code' ? (
            <input className="field" placeholder="Nueva contrasena" type="password" value={credentials.newPassword} onChange={(e) => setCredentials({ ...credentials, newPassword: e.target.value })} required />
          ) : null}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" size={16} /> : null}
            {mode === 'signup' ? 'Crear cuenta' : mode === 'verify' ? 'Verificar correo' : mode === 'reset' ? 'Enviar codigo' : mode === 'reset-code' ? 'Cambiar contrasena' : 'Iniciar sesion'}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <button className="text-zinc-700 underline" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'Crear cuenta' : 'Volver al login'}
          </button>
          <button className="text-zinc-700 underline" onClick={() => setMode('reset')}>
            Recuperar contrasena
          </button>
        </div>
      </section>
    </main>
  );
}

// Pantalla para usuarios creados pero pendientes de aprobacion por admin.
function PendingScreen({ profile, signOut, message }) {
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-100 px-4">
      <section className="panel max-w-lg p-6 text-center">
        <ShieldCheck className="mx-auto text-yellow-500" size={42} />
        <h1 className="mt-4 text-2xl font-bold">Tu cuenta esta pendiente de asignacion</h1>
        <p className="mt-2 text-zinc-600">
          Un administrador debe asignarte rol y departamentos para activar el acceso a tus tareas.
        </p>
        <div className="mt-5 rounded-md bg-zinc-50 p-4 text-left text-sm">
          <p><strong>Nombre:</strong> {profile?.full_name ?? 'Pendiente'}</p>
          <p><strong>Correo:</strong> {profile?.email ?? 'Pendiente'}</p>
          <p><strong>Estado:</strong> {profile?.status ?? 'pending'}</p>
        </div>
        {message ? <Notice>{message}</Notice> : null}
        <button className="btn btn-dark mt-5 w-full" onClick={signOut}>
          <LogOut size={16} /> Cerrar sesion
        </button>
      </section>
    </main>
  );
}

// Tarjetas de resumen con metricas del dashboard.
function SummaryPanel({ summary }) {
  const items = [
    ['Total', summary?.total_tasks ?? 0],
    ['Pendientes', summary?.pending_tasks ?? 0],
    ['En progreso', summary?.in_progress_tasks ?? 0],
    ['Completadas', summary?.completed_tasks ?? 0],
    ['Vencidas', summary?.overdue_tasks ?? 0],
    ['Alta prioridad', summary?.high_priority_tasks ?? 0]
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {items.map(([label, value]) => (
        <div className="panel p-4" key={label}>
          <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
          <p className="mt-2 text-2xl font-bold">{value}</p>
        </div>
      ))}
    </section>
  );
}

// Formulario para crear tareas normales o recurrentes.
function TaskCreator({ taskForm, setTaskForm, departments, activeProfiles, createTask, busy }) {
  return (
    <section className="panel p-4">
      <div className="mb-4 flex items-center gap-2">
        <Plus size={18} />
        <h2 className="text-lg font-bold">Crear tarea</h2>
      </div>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={createTask}>
        <input className="field md:col-span-2" placeholder="Nombre de tarea" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} required />
        <textarea className="field md:col-span-2" placeholder="Descripcion opcional" value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} />
        <Select value={taskForm.department_id} onChange={(value) => setTaskForm({ ...taskForm, department_id: value })} options={departments.map((item) => [item.id, item.name])} />
        <Select value={taskForm.responsible_id} onChange={(value) => setTaskForm({ ...taskForm, responsible_id: value })} options={[['', 'Sin responsable'], ...activeProfiles.map((item) => [item.id, item.full_name])]} />
        <Select value={taskForm.status} onChange={(value) => setTaskForm({ ...taskForm, status: value })} options={STATUSES} />
        <Select value={taskForm.priority} onChange={(value) => setTaskForm({ ...taskForm, priority: value })} options={PRIORITIES} />
        <input className="field" type="date" value={taskForm.start_date} onChange={(e) => setTaskForm({ ...taskForm, start_date: e.target.value })} />
        <input className="field" type="date" value={taskForm.due_date} onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })} />
        <label className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm">
          <input type="checkbox" checked={taskForm.repeat} onChange={(e) => setTaskForm({ ...taskForm, repeat: e.target.checked })} />
          Tarea repetitiva
        </label>
        {taskForm.repeat ? (
          <>
            <Select value={taskForm.frequency} onChange={(value) => setTaskForm({ ...taskForm, frequency: value })} options={FREQUENCIES} />
            {taskForm.frequency === 'specific_weekday' ? (
              <Select value={taskForm.weekday} onChange={(value) => setTaskForm({ ...taskForm, weekday: value })} options={[['1', 'Lunes'], ['2', 'Martes'], ['3', 'Miercoles'], ['4', 'Jueves'], ['5', 'Viernes'], ['6', 'Sabado'], ['0', 'Domingo']]} />
            ) : null}
          </>
        ) : null}
        <button className="btn btn-primary md:col-span-2" disabled={busy}>
          <Plus size={16} /> Guardar tarea
        </button>
      </form>
    </section>
  );
}

// Tabla principal de tareas con filtros y acciones rapidas.
function TaskBoard({ tasks, filters, setFilters, departments, departmentById, profileById, openTask, updateTask, busy }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} />
          <h2 className="text-lg font-bold">Tablero de tareas</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="relative">
            <Search className="absolute left-3 top-2.5 text-zinc-400" size={16} />
            <input className="field pl-9" placeholder="Buscar" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          </label>
          <Select value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} options={[['', 'Todos los estados'], ...STATUSES]} />
          <Select value={filters.department} onChange={(value) => setFilters({ ...filters, department: value })} options={[['', 'Todos los departamentos'], ...departments.map((item) => [item.id, item.name])]} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Tarea</th>
              <th className="px-4 py-3">Departamento</th>
              <th className="px-4 py-3">Responsable</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Prioridad</th>
              <th className="px-4 py-3">Fin</th>
              <th className="px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {tasks.map((task) => (
              <tr key={task.id} className="hover:bg-yellow-50/40">
                <td className="px-4 py-3">
                  <button className="flex items-center gap-1 font-semibold text-zinc-950" onClick={() => openTask(task)}>
                    {task.title} <ChevronRight size={14} />
                  </button>
                </td>
                <td className="px-4 py-3">{departmentById[task.department_id]?.name ?? 'Sin depto'}</td>
                <td className="px-4 py-3">{profileById[task.responsible_id]?.full_name ?? 'Sin responsable'}</td>
                <td className="px-4 py-3">{labelFrom(STATUSES, task.status)}</td>
                <td className="px-4 py-3">{labelFrom(PRIORITIES, task.priority)}</td>
                <td className="px-4 py-3">{task.due_date ?? '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button className="btn btn-soft" disabled={busy} onClick={() => updateTask(task, { status: 'completed' })}>
                      <Check size={14} />
                    </button>
                    <button className="btn btn-soft" disabled={busy} onClick={() => updateTask(task, { status: 'archived' })}>
                      <Archive size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Panel lateral con datos completos de la tarea seleccionada.
function TaskDetail({ task, comments, attachments, history, profileById, addComment, uploadAttachment, busy }) {
  return (
    <section className="panel p-4">
      <h2 className="text-lg font-bold">{task.title}</h2>
      <p className="mt-1 text-sm text-zinc-600">{task.description || 'Sin descripcion.'}</p>
      <div className="mt-4 grid gap-2 text-sm">
        <span>Estado: <strong>{labelFrom(STATUSES, task.status)}</strong></span>
        <span>Prioridad: <strong>{labelFrom(PRIORITIES, task.priority)}</strong></span>
        <span>Responsable: <strong>{profileById[task.responsible_id]?.full_name ?? 'Sin responsable'}</strong></span>
      </div>

      <form className="mt-4 flex gap-2" onSubmit={addComment}>
        <input className="field" name="comment" placeholder="Agregar comentario" />
        <button className="btn btn-dark">Enviar</button>
      </form>

      <label className="btn btn-soft mt-3 w-full cursor-pointer">
        <Paperclip size={16} /> Adjuntar archivo
        <input className="hidden" type="file" onChange={uploadAttachment} disabled={busy} />
      </label>

      <DetailList title="Comentarios" items={comments.map((item) => `${profileById[item.user_id]?.full_name ?? 'Usuario'}: ${item.comment}`)} />
      <DetailList title="Archivos" items={attachments.map((item) => `${item.file_name} (${item.file_type ?? 'archivo'})`)} />
      <DetailList title="Historial" items={history.map((item) => `${item.action} · ${new Date(item.created_at).toLocaleString()}`)} />
    </section>
  );
}

// Lista de notificaciones recientes; al hacer clic se marcan como leidas.
function NotificationsPanel({ notifications, markRead }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Bell size={18} />
        <h2 className="font-bold">Notificaciones</h2>
      </div>
      <div className="space-y-2">
        {notifications.slice(0, 8).map((item) => (
          <button key={item.id} className={`w-full rounded-md border p-3 text-left text-sm ${item.is_read ? 'border-zinc-200 bg-white' : 'border-yellow-200 bg-yellow-50'}`} onClick={() => markRead(item)}>
            {item.message}
          </button>
        ))}
        {!notifications.length ? <p className="text-sm text-zinc-500">No hay notificaciones.</p> : null}
      </div>
    </section>
  );
}

// Panel administrativo para aprobar usuarios y asignar roles/departamentos.
function AdminPanel({ profiles, departments, memberships, adminForm, setAdminForm, approveUser, busy }) {
  const pending = profiles.filter((item) => item.status === 'pending');
  const selectedUser = profiles.find((item) => item.id === adminForm.userId);

  function toggleDepartment(id, lead = false) {
    const key = lead ? 'leadDepartments' : 'departments';
    const exists = adminForm[key].includes(id);
    const next = exists ? adminForm[key].filter((item) => item !== id) : [...adminForm[key], id];
    const patch = { [key]: next };
    if (lead && !adminForm.departments.includes(id)) {
      patch.departments = [...adminForm.departments, id];
    }
    setAdminForm({ ...adminForm, ...patch });
  }

  useEffect(() => {
    if (!adminForm.userId && pending[0]?.id) {
      setAdminForm((current) => ({ ...current, userId: pending[0].id }));
    }
  }, [pending, adminForm.userId, setAdminForm]);

  useEffect(() => {
    if (!selectedUser) return;
    const currentMemberships = memberships.filter((item) => item.user_id === selectedUser.id && item.is_active);
    setAdminForm((current) => ({
      ...current,
      departments: currentMemberships.map((item) => item.department_id),
      leadDepartments: currentMemberships.filter((item) => item.role === 'lead').map((item) => item.department_id)
    }));
  }, [selectedUser?.id]);

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <UserCheck size={18} />
        <h2 className="font-bold">Administracion</h2>
      </div>
      <form className="space-y-3" onSubmit={approveUser}>
        <Select value={adminForm.userId} onChange={(value) => setAdminForm({ ...adminForm, userId: value })} options={profiles.map((item) => [item.id, `${item.full_name} · ${item.status}`])} />
        <Select value={adminForm.role} onChange={(value) => setAdminForm({ ...adminForm, role: value })} options={[['user', 'Usuario'], ['department_lead', 'Lider de departamento'], ['admin', 'Administrador']]} />
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase text-zinc-500">Departamentos</p>
          {departments.map((department) => (
            <label className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm" key={department.id}>
              <span>
                <input className="mr-2" type="checkbox" checked={adminForm.departments.includes(department.id)} onChange={() => toggleDepartment(department.id)} />
                {department.name}
              </span>
              <span>
                Lider
                <input className="ml-2" type="checkbox" checked={adminForm.leadDepartments.includes(department.id)} onChange={() => toggleDepartment(department.id, true)} />
              </span>
            </label>
          ))}
        </div>
        <button className="btn btn-primary w-full" disabled={busy || !adminForm.userId}>
          <ShieldCheck size={16} /> Aprobar / actualizar
        </button>
      </form>
    </section>
  );
}

// Reporte agrupado por departamento, estado y prioridad.
function ReportPanel({ report }) {
  return (
    <section className="panel p-4">
      <h2 className="mb-3 text-lg font-bold">Reporte basico</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {report.map((item) => (
          <div className="rounded-md border border-zinc-200 p-3 text-sm" key={`${item.department_id}-${item.status}-${item.priority}`}>
            <p className="font-semibold">{item.department_name}</p>
            <p>{labelFrom(STATUSES, item.status)} · {labelFrom(PRIORITIES, item.priority)}</p>
            <p className="mt-1 text-xl font-bold">{item.total}</p>
          </div>
        ))}
        {!report.length ? <p className="text-sm text-zinc-500">Sin datos de reporte todavia.</p> : null}
      </div>
    </section>
  );
}

// Componente reutilizable para listas simples dentro del detalle.
function DetailList({ title, items }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-2 space-y-2">
        {items.map((item, index) => (
          <p className="rounded-md bg-zinc-50 p-2 text-sm" key={`${title}-${index}`}>{item}</p>
        ))}
        {!items.length ? <p className="text-sm text-zinc-500">Sin registros.</p> : null}
      </div>
    </div>
  );
}

// Mensaje cuando aun no se ha seleccionado una tarea.
function EmptyDetail() {
  return (
    <section className="panel p-6 text-center text-sm text-zinc-500">
      Selecciona una tarea para ver detalle, comentarios, archivos e historial.
    </section>
  );
}

// Caja visual para mensajes de error, exito o informacion.
function Notice({ children }) {
  return <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-zinc-800">{children}</div>;
}

// Select reutilizable para mantener el mismo estilo en todos los formularios.
function Select({ value, onChange, options }) {
  return (
    <select className="field" value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      {options.map(([key, label]) => (
        <option key={key || 'empty'} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}

// Pantalla completa de carga inicial.
function FullScreenLoading() {
  return (
    <main className="grid min-h-screen place-items-center">
      <div className="flex items-center gap-3 text-zinc-600">
        <Loader2 className="animate-spin" />
        Cargando Nomada Tasks...
      </div>
    </main>
  );
}
