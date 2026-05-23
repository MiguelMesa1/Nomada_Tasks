'use client';

/**
 * Pagina principal de Nomada Tasks.
 *
 * Este archivo contiene autenticacion, carga de datos, gestion de tareas,
 * notificaciones, comentarios, archivos adjuntos y paneles de administracion.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Archive,
  Bell,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardList,
  Edit3,
  ExternalLink,
  Loader2,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  UserCheck,
  X
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
  weekdays: ['2'],
  month_day: '1',
  interval_days: '2'
};

const BOARD_STATUSES = STATUSES.filter(([status]) => status !== 'completed' && status !== 'archived');
const WEEK_DAYS = [
  ['1', 'L', 'Lunes'],
  ['2', 'M', 'Martes'],
  ['3', 'M', 'Miercoles'],
  ['4', 'J', 'Jueves'],
  ['5', 'V', 'Viernes'],
  ['6', 'S', 'Sabado'],
  ['0', 'D', 'Domingo']
];
const AUTH_STORAGE_KEY = 'nomada_tasks_auth_session';
const MAX_TASK_TITLE_LENGTH = 200;
const MAX_TASK_DESCRIPTION_LENGTH = 5000;
const MAX_COMMENT_LENGTH = 2000;
const MAX_PROFILE_NAME_LENGTH = 120;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

function formatError(error) {
  if (!error) return 'Error desconocido.';
  if (typeof error === 'string') return error;
  return error.message || error.error || JSON.stringify(error);
}

function isAllowedAttachment(file) {
  if (!file) return false;
  if (file.size > MAX_ATTACHMENT_BYTES) return false;
  return ALLOWED_ATTACHMENT_TYPES.has(file.type || 'text/plain');
}

function startDateFromForm(taskForm) {
  const date = taskForm.start_date || new Date().toISOString().slice(0, 10);
  return new Date(`${date}T06:00:00`);
}

function nextRunFromForm(taskForm) {
  return nextRunsFromForm(taskForm)[0];
}

function nextRunsFromForm(taskForm) {
  const base = startDateFromForm(taskForm);
  const candidate = new Date(base);

  if (taskForm.frequency === 'weekly') {
    const selected = taskForm.weekdays.map(Number);
    return selected
      .map((weekday) => {
        const next = new Date(base);
        const diff = (weekday - base.getDay() + 7) % 7;
        next.setDate(base.getDate() + diff);
        return next;
      })
      .sort((left, right) => left - right);
  }

  if (taskForm.frequency === 'monthly') {
    const monthDay = Math.min(Math.max(Number(taskForm.month_day) || 1, 1), 31);
    candidate.setDate(Math.min(monthDay, daysInMonth(candidate)));
    if (candidate < base) {
      candidate.setMonth(candidate.getMonth() + 1);
      candidate.setDate(Math.min(monthDay, daysInMonth(candidate)));
    }
    return [candidate];
  }

  return [candidate];
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function formatScheduleText(rule) {
  if (rule.frequency === 'daily') return 'Se crea todos los dias';
  if (rule.frequency === 'monthly') return `Se crea el dia ${rule.month_day ?? 1} de cada mes`;
  if (rule.frequency === 'custom_interval') return `Se crea cada ${rule.interval_days ?? 2} dias`;

  const selected = (rule.weekdays?.length ? rule.weekdays : [rule.weekday])
    .filter((day) => day !== null && day !== undefined)
    .map(String);
  const names = WEEK_DAYS.filter(([value]) => selected.includes(value)).map(([, , name]) => name.toLowerCase());
  return names.length ? `Se crea ${joinList(names)}` : 'Se crea semanalmente';
}

function formatRecurringDate(value, month = 'long') {
  const date = new Date(value);
  const weekdayName = date.toLocaleDateString('es-CO', { weekday: 'long' });
  const monthName = date.toLocaleDateString('es-CO', { month });
  return `${weekdayName} ${date.getDate()} de ${monthName}`;
}

function nextRecurringMessage(rule) {
  if (!rule?.next_run_at) return '';
  return `Se agregara automaticamente el ${formatRecurringDate(rule.next_run_at)}.`;
}

function nextAssignmentMessage(rule) {
  if (!rule?.next_run_at) return 'No hay una proxima fecha calculada.';
  return `Se te asignara el dia ${formatRecurringDate(rule.next_run_at)}.`;
}

function nextDatesForRule(rule, maxDates = 3) {
  if (!rule?.next_run_at) return [];
  const base = new Date(rule.next_run_at);

  if (rule.frequency === 'weekly') {
    const selected = (rule.weekdays?.length ? rule.weekdays : [rule.weekday])
      .filter((day) => day !== null && day !== undefined)
      .map(Number);
    const dates = [];
    for (let offset = 0; offset <= 21 && dates.length < maxDates; offset += 1) {
      const candidate = new Date(base);
      candidate.setDate(base.getDate() + offset);
      if (selected.includes(candidate.getDay())) {
        dates.push(candidate);
      }
    }
    return dates;
  }

  if (rule.frequency === 'daily') {
    return Array.from({ length: maxDates }, (_, index) => {
      const date = new Date(base);
      date.setDate(base.getDate() + index);
      return date;
    });
  }

  if (rule.frequency === 'custom_interval') {
    return Array.from({ length: maxDates }, (_, index) => {
      const date = new Date(base);
      date.setDate(base.getDate() + index * (rule.interval_days ?? 1));
      return date;
    });
  }

  if (rule.frequency === 'monthly') {
    return Array.from({ length: maxDates }, (_, index) => {
      const date = new Date(base);
      date.setMonth(base.getMonth() + index);
      return date;
    });
  }

  return [base];
}

function recurringCompletionMessage(task, rule) {
  if (!task.is_recurring) return 'Tarea actualizada.';
  const nextMessage = nextRecurringMessage(rule);
  return nextMessage
    ? `Tarea completada. ${nextMessage}`
    : 'Tarea completada. Esta tarea repetitiva se seguira creando automaticamente segun su regla.';
}

function joinList(items) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;
}

function taskLooksLikeRecurringOccurrence(task, rule, taskById) {
  const baseTask = taskById.get(rule.task_base_id);
  if (!baseTask || baseTask.id === task.id || !task.is_recurring) return false;

  return (
    task.title === baseTask.title &&
    task.department_id === baseTask.department_id &&
    (task.responsible_id ?? null) === (baseTask.responsible_id ?? null) &&
    task.priority === baseTask.priority
  );
}

function buildTaskRecurrenceMap(tasks, rules) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const activeRules = rules.filter((rule) => rule.is_active);

  return Object.fromEntries(
    tasks
      .map((task) => {
        const rule = activeRules.find((item) =>
          item.task_base_id === task.id ||
          item.id === task.recurring_rule_id ||
          taskLooksLikeRecurringOccurrence(task, item, taskById)
        );
        return rule ? [task.id, rule] : null;
      })
      .filter(Boolean)
  );
}

function isRecurringTemplate(task, activeRuleBaseIds) {
  return task.is_recurring && activeRuleBaseIds.has(task.id);
}

function profileName(profile, fallback = 'Usuario') {
  const name = profile?.full_name?.trim();
  if (name && !name.includes('@')) return name;
  return fallback;
}

function normalizeProfileResult(data) {
  return Array.isArray(data) ? data[0] : data;
}

function readStoredSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStoredSession(response) {
  if (typeof window === 'undefined' || !response?.accessToken || !response?.user) return;
  try {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
      accessToken: response.accessToken,
      user: response.user
    }));
  } catch {
    // Si el navegador bloquea storage, la sesion httpOnly del SDK sigue siendo el camino principal.
  }
}

function clearStoredSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

const HISTORY_ACTIONS = {
  task_created: 'Tarea creada',
  task_updated: 'Tarea actualizada',
  comment_added: 'Comentario agregado',
  file_attached: 'Archivo adjuntado'
};

const HISTORY_FIELDS = {
  title: 'Titulo',
  description: 'Descripcion',
  department_id: 'Departamento',
  responsible_id: 'Responsable',
  status: 'Estado',
  priority: 'Prioridad',
  start_date: 'Fecha inicio',
  due_date: 'Fecha fin'
};

function formatHistoryValue(field, value) {
  if (value === null || value === undefined || value === '') return '-';
  if (field === 'status') return labelFrom(STATUSES, value);
  if (field === 'priority') return labelFrom(PRIORITIES, value);
  return String(value);
}

function formatHistoryItem(item, profileById = {}) {
  const actorName = profileName(profileById[item.user_id], 'Alguien');
  const actionLabels = {
    task_created: `${actorName} creo la tarea`,
    task_updated: `${actorName} actualizo la tarea`,
    comment_added: `${actorName} escribio un comentario`,
    file_attached: `${actorName} subio un archivo`
  };
  const title = actionLabels[item.action] ?? `${actorName} hizo una accion: ${item.action.replaceAll('_', ' ')}`;
  const previous = item.previous_value ?? {};
  const next = item.new_value ?? {};
  const fields = Object.keys({ ...previous, ...next }).filter((field) => HISTORY_FIELDS[field]);

  if (!fields.length || item.action === 'task_created') return title;

  const changes = fields.map((field) => {
    const before = formatHistoryValue(field, previous[field]);
    const after = formatHistoryValue(field, next[field]);
    return `${HISTORY_FIELDS[field]}: ${before} -> ${after}`;
  });

  return `${title}: ${changes.join(', ')}`;
}

export default function Home() {
  // Estado de autenticacion, carga general y mensajes para el usuario.
  const [authMode, setAuthMode] = useState('signin');
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Datos principales que llegan desde InsForge.
  const [departments, setDepartments] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [recurringRules, setRecurringRules] = useState([]);
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
  const [settingsForm, setSettingsForm] = useState({
    name: '',
    email: '',
    passwordCode: '',
    newPassword: '',
    requestedDepartmentId: '',
    departmentReason: ''
  });

  // Banderas y listas derivadas para simplificar condiciones en la UI.
  const isAdmin = profile?.role === 'admin' && profile?.status === 'active';
  const activeProfiles = profiles.filter((item) => item.status === 'active');
  const assignableProfiles = activeProfiles.filter((item) => isAdmin || item.role !== 'admin');
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
  // El tablero operativo oculta completadas y archivadas por defecto; esas viven
  // en sus apartados propios para que el flujo diario quede limpio.
  const activeRecurringBaseIds = new Set(
    recurringRules.filter((rule) => rule.is_active).map((rule) => rule.task_base_id)
  );
  const visibleTasks = tasks.filter((task) => {
    const text = `${task.title} ${task.description ?? ''}`.toLowerCase();
    return (
      !isRecurringTemplate(task, activeRecurringBaseIds) &&
      task.status !== 'completed' &&
      task.status !== 'archived' &&
      (!filters.search || text.includes(filters.search.toLowerCase())) &&
      (!filters.status || task.status === filters.status) &&
      (!filters.department || task.department_id === filters.department)
    );
  });

  const completedTasks = tasks.filter((task) => task.status === 'completed');
  const archivedTasks = tasks.filter((task) => task.status === 'archived' && !isRecurringTemplate(task, activeRecurringBaseIds));
  const usefulNotifications = notifications.filter((item) => !['status_changed', 'task_completed'].includes(item.type));
  const unreadNotifications = usefulNotifications.filter((item) => !item.is_read).length;
  const recurrenceByTaskId = useMemo(
    () => buildTaskRecurrenceMap(tasks, recurringRules),
    [tasks, recurringRules]
  );
  const activeRecurringRules = recurringRules
    .filter((rule) => rule.is_active)
    .map((rule) => ({
      ...rule,
      task: tasks.find((task) => task.id === rule.task_base_id) ?? {
        id: rule.task_base_id,
        title: 'Tarea repetitiva'
      }
    }));
  const recurringTaskFallbacks = tasks
    .filter((task) => task.is_recurring && !activeRecurringRules.some((rule) => rule.task_base_id === task.id || rule.id === task.recurring_rule_id))
    .map((task) => ({
      id: `task-${task.id}`,
      task_base_id: task.id,
      is_active: true,
      frequency: 'weekly',
      weekdays: [],
      next_run_at: null,
      task,
      inferred: true
    }));
  const recurringOverviewItems = [...activeRecurringRules, ...recurringTaskFallbacks];

  // Al montar la pagina, revisa si ya hay sesion activa y carga el workspace.
  useEffect(() => {
    hydrate();
  }, []);

  // Carga inicial: obtiene el usuario actual y, si existe, trae su perfil y datos.
  async function hydrate() {
    setLoading(true);
    let { data, error } = await insforge.auth.getCurrentUser();
    const currentUser = data?.user ?? null;
    let hydratedUser = currentUser;

    if (!hydratedUser) {
      hydratedUser = await restoreStoredSession();
      if (error && !hydratedUser) {
        clearStoredSession();
      }
    }

    setUser(hydratedUser);
    if (hydratedUser) {
      const ensuredProfile = await ensureProfile(credentials.name);
      if (ensuredProfile) {
        await loadWorkspace();
      }
    }
    setLoading(false);
  }

  async function restoreStoredSession() {
    const stored = readStoredSession();
    if (!stored?.accessToken) return null;

    try {
      insforge.setAccessToken(stored.accessToken);
      const response = await insforge.getHttpClient().get('/api/auth/sessions/current');
      const restoredUser = response?.user ?? stored.user ?? null;
      if (!restoredUser) {
        clearStoredSession();
        insforge.setAccessToken(null);
        return null;
      }
      saveStoredSession({ accessToken: stored.accessToken, user: restoredUser });
      return restoredUser;
    } catch {
      clearStoredSession();
      insforge.setAccessToken(null);
      return null;
    }
  }

  // Crea o actualiza el perfil del usuario actual en la base de datos.
  async function ensureProfile(name) {
    const { data, error } = await insforge.database.rpc('ensure_current_profile', {
      profile_full_name: name || null
    });
    if (error) {
      setMessage(error.message ?? 'No se pudo preparar el perfil.');
      setProfileLoadFailed(true);
      return null;
    }
    const ensuredProfile = normalizeProfileResult(data);
    setProfileLoadFailed(false);
    setProfile(ensuredProfile);
    setSettingsForm((current) => ({
      ...current,
      name: ensuredProfile?.full_name ?? current.name,
      email: ensuredProfile?.email ?? current.email
    }));
    return ensuredProfile;
  }

  // Carga en paralelo departamentos, perfiles, tareas, notificaciones y reportes.
  async function loadWorkspace() {
    await materializeRecurringTasks();
    await purgeExpiredArchivedTasks();

    const [
      departmentResult,
      membershipResult,
      profileResult,
      taskResult,
      recurringRuleResult,
      notificationResult,
      summaryResult,
      reportResult
    ] = await Promise.all([
      insforge.database.from('departments').select('*').order('name'),
      insforge.database.from('user_department_memberships').select('*'),
      insforge.database.from('profiles').select('*').order('created_at', { ascending: false }),
      insforge.database.from('tasks').select('*').order('created_at', { ascending: false }),
      insforge.database.from('recurring_task_rules').select('*').eq('is_active', true).order('next_run_at', { ascending: true }),
      insforge.database.from('notifications').select('*').order('created_at', { ascending: false }).limit(30),
      insforge.database.rpc('dashboard_summary'),
      insforge.database.rpc('task_report')
    ]);

    setDepartments(departmentResult.data ?? []);
    setMemberships(membershipResult.data ?? []);
    setProfiles(profileResult.data ?? []);
    setTasks(taskResult.data ?? []);
    setRecurringRules(recurringRuleResult.data ?? []);
    setNotifications(notificationResult.data ?? []);
    setSummary(Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data);
    setReport(reportResult.data ?? []);

    if (!taskForm.department_id && departmentResult.data?.[0]?.id) {
      setTaskForm((current) => ({ ...current, department_id: departmentResult.data[0].id }));
    }
  }

  async function materializeRecurringTasks() {
    const { error } = await insforge.database.rpc('generate_recurring_tasks');
    if (error) {
      console.warn('No se pudieron generar tareas repetitivas pendientes:', error.message ?? error);
    }
  }

  async function purgeExpiredArchivedTasks() {
    const { error } = await insforge.database.rpc('purge_expired_archived_tasks');
    if (error) {
      console.warn('No se pudieron limpiar archivadas vencidas:', error.message ?? error);
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
      saveStoredSession(data);
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
      saveStoredSession(data);
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
      saveStoredSession(data);
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

  async function updateOwnProfile(event) {
    event.preventDefault();
    const trimmedName = settingsForm.name.trim();
    if (!trimmedName || trimmedName.length > MAX_PROFILE_NAME_LENGTH) {
      setMessage('El nombre debe tener entre 1 y 120 caracteres.');
      return;
    }
    setBusy(true);
    setMessage('');
    const { data, error } = await insforge.database.rpc('update_own_profile', {
      profile_full_name: trimmedName,
      profile_email: settingsForm.email.trim()
    });
    if (error) {
      setMessage(error.message ?? 'No se pudo actualizar tu perfil.');
    } else {
      const updatedProfile = normalizeProfileResult(data) ?? await ensureProfile(settingsForm.name);
      if (updatedProfile) {
        setProfile(updatedProfile);
        setSettingsForm((current) => ({
          ...current,
          name: updatedProfile.full_name ?? current.name,
          email: updatedProfile.email ?? current.email
        }));
        setProfiles((current) => current.map((item) => (item.id === updatedProfile.id ? updatedProfile : item)));
      }
      await loadWorkspace();
      setMessage('Perfil actualizado.');
    }
    setBusy(false);
  }

  async function sendSettingsPasswordCode(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const { error } = await insforge.auth.sendResetPasswordEmail({
      email: settingsForm.email || profile?.email,
      redirectTo: `${window.location.origin}/reset-password`
    });
    setMessage(error ? error.message : 'Codigo de cambio de contrasena enviado.');
    setBusy(false);
  }

  async function updateSettingsPassword(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const exchange = await insforge.auth.exchangeResetPasswordToken({
      email: settingsForm.email || profile?.email,
      code: settingsForm.passwordCode
    });
    if (exchange.error) {
      setMessage(exchange.error.message ?? 'Codigo invalido.');
      setBusy(false);
      return;
    }
    const { error } = await insforge.auth.resetPassword({
      newPassword: settingsForm.newPassword,
      otp: exchange.data.token
    });
    setMessage(error ? error.message : 'Contrasena actualizada.');
    if (!error) {
      setSettingsForm((current) => ({ ...current, passwordCode: '', newPassword: '' }));
    }
    setBusy(false);
  }

  async function requestDepartmentChange(event) {
    event.preventDefault();
    if (settingsForm.departmentReason.length > MAX_COMMENT_LENGTH) {
      setMessage('El motivo no puede superar 2000 caracteres.');
      return;
    }
    setBusy(true);
    setMessage('');
    const { error } = await insforge.database.rpc('request_department_change', {
      requested_department_id: settingsForm.requestedDepartmentId || null,
      request_reason: settingsForm.departmentReason || null
    });
    setMessage(error ? error.message : 'Solicitud enviada a administracion.');
    if (!error) {
      setSettingsForm((current) => ({ ...current, requestedDepartmentId: '', departmentReason: '' }));
    }
    setBusy(false);
  }

  async function deactivateRecurringRule(rule) {
    setBusy(true);
    setMessage('');
    const { error } = await insforge.database
      .from('recurring_task_rules')
      .update({ is_active: false })
      .eq('id', rule.id);
    setMessage(error ? error.message : 'Tarea repetitiva desactivada.');
    await loadWorkspace();
    setBusy(false);
  }

  // Cierra la sesion y limpia datos sensibles de la pantalla.
  async function signOut() {
    await insforge.auth.signOut();
    clearStoredSession();
    insforge.setAccessToken(null);
    setUser(null);
    setProfile(null);
    setTasks([]);
    setRecurringRules([]);
    setNotifications([]);
    setSelectedTask(null);
  }

  // Crea una tarea y, si es recurrente, registra su regla de repeticion.
  async function createTask(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const title = taskForm.title.trim();
    const description = taskForm.description.trim();

    if (!title || title.length > MAX_TASK_TITLE_LENGTH) {
      setMessage('El titulo debe tener entre 1 y 200 caracteres.');
      setBusy(false);
      return;
    }

    if (description.length > MAX_TASK_DESCRIPTION_LENGTH) {
      setMessage('La descripcion no puede superar 5000 caracteres.');
      setBusy(false);
      return;
    }

    if (taskForm.responsible_id && !assignableProfiles.some((item) => item.id === taskForm.responsible_id)) {
      setMessage('No puedes asignar esta tarea a ese usuario.');
      setBusy(false);
      return;
    }

    const payload = {
      title,
      description: description || null,
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
      const nextRunAt = nextRunFromForm(taskForm);
      const { data: newRules, error: recurringError } = await insforge.database.from('recurring_task_rules').insert([
        {
          task_base_id: newTask.id,
          frequency: taskForm.frequency,
          weekday: taskForm.frequency === 'weekly' ? Number(taskForm.weekdays[0]) : null,
          weekdays: taskForm.frequency === 'weekly' ? taskForm.weekdays.map(Number) : [],
          month_day: taskForm.frequency === 'monthly' ? Number(taskForm.month_day) : null,
          interval_days: taskForm.frequency === 'custom_interval' ? Number(taskForm.interval_days) : null,
          scheduled_time: '06:00',
          start_date: taskForm.start_date || new Date().toISOString().slice(0, 10),
          next_run_at: nextRunAt.toISOString()
        }
      ]).select();

      if (recurringError) {
        await insforge.database.from('tasks').update({ status: 'archived' }).eq('id', newTask.id);
        setMessage(`La tarea se creo, pero no se pudo programar la repeticion: ${formatError(recurringError)}`);
        await loadWorkspace();
        setBusy(false);
        return;
      }

      if (newRules?.[0]?.id) {
        await insforge.database.from('tasks').update({ recurring_rule_id: newRules[0].id }).eq('id', newTask.id);
        await materializeRecurringTasks();
      }
    }

    setTaskForm((current) => ({ ...emptyTask, department_id: current.department_id }));
    await loadWorkspace();
    setMessage(taskForm.repeat ? `Tarea repetitiva creada. ${nextAssignmentMessage({ next_run_at: nextRunFromForm(taskForm) })}` : 'Tarea creada correctamente.');
    setBusy(false);
  }

  // Actualiza campos puntuales de una tarea, por ejemplo estado o archivado.
  async function updateTask(task, patch) {
    if (typeof patch.title === 'string') {
      const title = patch.title.trim();
      if (!title || title.length > MAX_TASK_TITLE_LENGTH) {
        setMessage('El titulo debe tener entre 1 y 200 caracteres.');
        return;
      }
      patch = { ...patch, title };
    }
    if (typeof patch.description === 'string' && patch.description.length > MAX_TASK_DESCRIPTION_LENGTH) {
      setMessage('La descripcion no puede superar 5000 caracteres.');
      return;
    }
    setBusy(true);
    const { error } = await insforge.database.from('tasks').update(patch).eq('id', task.id);
    const rule = recurrenceByTaskId[task.id];
    const successMessage = patch.status === 'completed'
      ? recurringCompletionMessage(task, rule)
      : patch.status === 'archived'
        ? 'Tarea enviada a papeleria. Se quedara alli 3 dias y luego se borrara permanentemente.'
        : 'Tarea actualizada.';
    setMessage(error ? error.message : successMessage);
    await loadWorkspace();
    if (selectedTask?.id === task.id) {
      await openTask({ ...task, ...patch });
    }
    setBusy(false);
  }

  async function deleteTaskPermanently(task) {
    if (!isAdmin) {
      setMessage('Solo administradores pueden borrar tareas permanentemente.');
      return;
    }

    const confirmed = window.confirm(`Borrar permanentemente "${task.title}"? Esta accion no se puede deshacer.`);
    if (!confirmed) return;

    setBusy(true);
    setMessage('');
    const { error } = await insforge.database.from('tasks').delete().eq('id', task.id);
    setMessage(error ? error.message : 'Tarea borrada permanentemente.');
    if (!error && selectedTask?.id === task.id) {
      setSelectedTask(null);
    }
    await loadWorkspace();
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
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const comment = form.get('comment')?.toString().trim();
    if (!comment || !selectedTask) return;
    if (comment.length > MAX_COMMENT_LENGTH) {
      setMessage('El comentario no puede superar 2000 caracteres.');
      return;
    }

    const { error } = await insforge.database.from('task_comments').insert([
      { task_id: selectedTask.id, comment }
    ]);
    setMessage(error ? error.message : 'Comentario agregado.');
    if (!error) {
      formElement.reset();
    }
    await openTask(selectedTask);
    await loadWorkspace();
  }

  // Sube un archivo al storage y registra el adjunto en la base de datos.
  async function uploadAttachment(event) {
    const inputElement = event.currentTarget;
    const file = inputElement.files?.[0];
    if (!file || !selectedTask) return;
    if (!isAllowedAttachment(file)) {
      setMessage('Archivo no permitido. Usa imagen, PDF, documento, hoja de calculo o texto de maximo 10 MB.');
      inputElement.value = '';
      return;
    }
    setBusy(true);
    setMessage('');
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const key = `tasks/${selectedTask.id}/${Date.now()}-${safeName}`;
    const upload = await insforge.storage.from('task-attachments').upload(key, file);
    if (upload.error) {
      setMessage(`No se pudo subir el archivo: ${formatError(upload.error)}`);
      setBusy(false);
      return;
    }

    const { error } = await insforge.database.from('task_attachments').insert([
      {
        task_id: selectedTask.id,
        file_name: file.name,
        storage_key: upload.data?.key ?? key,
        file_url: upload.data?.url ?? null,
        file_type: file.type || 'archivo',
        file_size: file.size
      }
    ]);
    setMessage(error ? `El archivo subio, pero no se pudo registrar: ${formatError(error)}` : 'Archivo adjuntado.');
    if (!error) {
      inputElement.value = '';
    }
    await openTask(selectedTask);
    await loadWorkspace();
    setBusy(false);
  }

  async function openAttachment(attachment) {
    setBusy(true);
    setMessage('');
    const previewWindow = window.open('', '_blank', 'noopener,noreferrer');
    const bucket = attachment.storage_bucket || 'task-attachments';
    const { data, error } = await insforge.storage.from(bucket).download(attachment.storage_key);
    if (error) {
      previewWindow?.close();
      setMessage(`No se pudo abrir el archivo: ${formatError(error)}`);
      setBusy(false);
      return;
    }

    const url = URL.createObjectURL(data);
    if (previewWindow) {
      previewWindow.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
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

  async function openNotification(notification) {
    await markNotificationRead(notification);
    const task = tasks.find((item) => item.id === notification.task_id);
    if (task) {
      await openTask(task);
    }
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
    return <PendingScreen profile={profile} signOut={signOut} message={message} profileLoadFailed={profileLoadFailed} />;
  }

  // Vista principal para usuarios activos: tablero, detalle, reportes y admin.
  return (
    <main className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-yellow-600">Nomada Moto Partes</p>
            <h1 className="text-2xl font-bold text-zinc-950">Nomada Tasks</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-zinc-100 px-3 py-2 text-sm">
              {profileName(profile)} · {profile?.role}
            </span>
            <NotificationBell
              notifications={usefulNotifications}
              unreadCount={unreadNotifications}
              openNotification={openNotification}
            />
            <button className="btn btn-soft" onClick={() => setSettingsOpen(true)} aria-label="Abrir ajustes">
              <Settings size={16} /> Ajustes
            </button>
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
          <RecurringOverview rules={recurringOverviewItems} onOpen={() => setRecurringOpen(true)} />
          <TaskCreator
            taskForm={taskForm}
            setTaskForm={setTaskForm}
            departments={departments}
            activeProfiles={assignableProfiles}
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
            recurrenceByTaskId={recurrenceByTaskId}
            assignableProfiles={assignableProfiles}
            openTask={openTask}
            updateTask={updateTask}
            busy={busy}
          />
          <ArchiveBanner archivedCount={archivedTasks.length} onOpen={() => setArchiveOpen(true)} />
          <CompletedTasksPanel
            tasks={completedTasks}
            departmentById={departmentById}
            profileById={profileById}
            openTask={openTask}
            updateTask={updateTask}
            busy={busy}
          />
          <ReportPanel report={report} />
        </section>

        <aside className="space-y-4">
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
      {selectedTask ? (
        <TaskDetailModal
          key={selectedTask.id}
          task={selectedTask}
          comments={comments}
          attachments={attachments}
          history={history}
          profileById={profileById}
          assignableProfiles={assignableProfiles}
          addComment={addComment}
          uploadAttachment={uploadAttachment}
          openAttachment={openAttachment}
          updateTask={updateTask}
          busy={busy}
          onClose={() => setSelectedTask(null)}
        />
      ) : null}
      {recurringOpen ? (
        <RecurringRulesModal rules={recurringOverviewItems} deactivateRule={deactivateRecurringRule} busy={busy} onClose={() => setRecurringOpen(false)} />
      ) : null}
      {archiveOpen ? (
        <ArchivedTasksModal
          tasks={archivedTasks}
          departmentById={departmentById}
          profileById={profileById}
          openTask={openTask}
          updateTask={updateTask}
          deleteTaskPermanently={deleteTaskPermanently}
          isAdmin={isAdmin}
          busy={busy}
          onClose={() => setArchiveOpen(false)}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsPanel
          profile={profile}
          departments={departments}
          settingsForm={settingsForm}
          setSettingsForm={setSettingsForm}
          updateOwnProfile={updateOwnProfile}
          sendPasswordCode={sendSettingsPasswordCode}
          updatePassword={updateSettingsPassword}
          requestDepartmentChange={requestDepartmentChange}
          canRequestDepartmentChange={!isAdmin}
          busy={busy}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
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
            <input className="field" placeholder="Nombre y apellido" value={credentials.name} onChange={(e) => setCredentials({ ...credentials, name: e.target.value })} required />
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
function PendingScreen({ profile, signOut, message, profileLoadFailed = false }) {
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-100 px-4">
      <section className="panel max-w-lg p-6 text-center">
        <ShieldCheck className="mx-auto text-yellow-500" size={42} />
        <h1 className="mt-4 text-2xl font-bold">
          {profileLoadFailed ? 'No pudimos cargar tu perfil' : 'Tu cuenta esta pendiente de asignacion'}
        </h1>
        <p className="mt-2 text-zinc-600">
          {profileLoadFailed
            ? 'Tu sesion existe, pero hubo un problema consultando tu perfil. Intenta recargar en unos segundos.'
            : 'Un administrador debe asignarte rol y departamentos para activar el acceso a tus tareas.'}
        </p>
        {!profileLoadFailed ? (
          <div className="mt-5 rounded-md bg-zinc-50 p-4 text-left text-sm">
            <p><strong>Nombre:</strong> {profileName(profile, 'Pendiente')}</p>
            <p><strong>Correo:</strong> {profile?.email ?? 'Pendiente'}</p>
            <p><strong>Estado:</strong> {profile?.status ?? 'pending'}</p>
          </div>
        ) : null}
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

function RecurringOverview({ rules, onOpen }) {
  if (!rules.length) return null;

  return (
    <button
      className="panel flex w-full flex-col gap-3 border-yellow-200 bg-yellow-50/55 p-4 text-left transition hover:border-yellow-300 hover:bg-yellow-50 md:flex-row md:items-center md:justify-between"
      onClick={onOpen}
      type="button"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-nomada-yellow text-zinc-950">
          <CalendarClock size={22} />
        </span>
        <div>
          <p className="text-xs font-bold uppercase text-yellow-700">Tareas repetitivas</p>
          <h2 className="text-lg font-black text-zinc-950">
            Tienes {rules.length} {rules.length === 1 ? 'tarea repetitiva activa' : 'tareas repetitivas activas'}
          </h2>
        </div>
      </div>
      <div className="text-sm font-bold text-zinc-700">
        Ver programacion
      </div>
    </button>
  );
}

function ArchiveBanner({ archivedCount, onOpen }) {
  if (!archivedCount) return null;

  return (
    <button
      className="panel flex w-full flex-col gap-3 border-zinc-300 bg-zinc-50 p-4 text-left transition hover:border-zinc-500 hover:bg-white md:flex-row md:items-center md:justify-between"
      onClick={onOpen}
      type="button"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-zinc-900 text-white">
          <Archive size={22} />
        </span>
        <div>
          <p className="text-xs font-bold uppercase text-zinc-500">Papelera</p>
          <h2 className="text-lg font-black text-zinc-950">
            {archivedCount} {archivedCount === 1 ? 'tarea archivada' : 'tareas archivadas'}
          </h2>
          <p className="mt-1 text-sm font-semibold text-zinc-600">
            Se borran permanentemente despues de 3 dias.
          </p>
        </div>
      </div>
      <div className="text-sm font-bold text-zinc-700">
        Ver archivadas
      </div>
    </button>
  );
}

function ArchivedTasksModal({ tasks, departmentById, profileById, openTask, updateTask, deleteTaskPermanently, isAdmin, busy, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/55 px-0 py-0 backdrop-blur-sm md:px-6 md:py-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="relative mx-auto flex h-full max-w-4xl flex-col overflow-hidden bg-white shadow-2xl md:rounded-lg">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase text-zinc-500">Papelera</p>
            <h2 className="text-xl font-black text-zinc-950">Tareas archivadas</h2>
          </div>
          <button className="rounded-full p-2 text-zinc-800 transition hover:bg-zinc-100" onClick={onClose} aria-label="Cerrar archivadas">
            <X size={24} />
          </button>
        </header>

        <div className="border-b border-zinc-100 bg-zinc-50 px-5 py-3 text-sm font-semibold text-zinc-600">
          Las tareas archivadas se quedan 3 dias en papeleria y luego se borran permanentemente.
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tasks.length ? (
            <div className="overflow-x-auto rounded-md border border-zinc-200">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Tarea</th>
                    <th className="px-4 py-3">Departamento</th>
                    <th className="px-4 py-3">Responsable</th>
                    <th className="px-4 py-3">Archivada</th>
                    <th className="px-4 py-3">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {tasks.map((task) => (
                    <tr key={task.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-3">
                        <button className="flex items-center gap-1 font-semibold text-zinc-950" onClick={() => openTask(task)}>
                          {task.title} <ChevronRight size={14} />
                        </button>
                      </td>
                      <td className="px-4 py-3">{departmentById[task.department_id]?.name ?? 'Sin depto'}</td>
                      <td className="px-4 py-3">{profileName(profileById[task.responsible_id], 'Sin responsable')}</td>
                      <td className="px-4 py-3">
                        {task.archived_at ? new Date(task.archived_at).toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button className="btn btn-soft" disabled={busy} onClick={() => updateTask(task, { status: 'in_progress' })}>
                            <RefreshCw size={14} /> Restaurar
                          </button>
                          {isAdmin ? (
                            <button className="btn btn-dark" disabled={busy} onClick={() => deleteTaskPermanently(task)}>
                              <Archive size={14} /> Borrar para siempre
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-md bg-zinc-50 p-4 text-sm text-zinc-500">No hay tareas archivadas.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function RecurringRulesModal({ rules, deactivateRule, busy, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/55 px-0 py-0 backdrop-blur-sm md:px-6 md:py-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="relative mx-auto flex h-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl md:rounded-lg">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase text-yellow-700">Programacion</p>
            <h2 className="text-xl font-black text-zinc-950">Tareas repetitivas</h2>
          </div>
          <button className="rounded-full p-2 text-zinc-800 transition hover:bg-zinc-100" onClick={onClose} aria-label="Cerrar tareas repetitivas">
            <X size={24} />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {rules.map((rule) => {
            const nextDates = nextDatesForRule(rule);
            return (
              <article className="rounded-md border border-zinc-200 p-4" key={rule.id}>
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="font-black text-zinc-950">{rule.task.title}</h3>
                    <p className="mt-1 text-sm font-semibold text-zinc-600">{formatScheduleText(rule)}</p>
                  </div>
                  <span className="w-fit rounded-full bg-yellow-50 px-3 py-1 text-xs font-bold text-yellow-700">
                    Activa
                  </span>
                </div>
                <div className="mt-4 rounded-md bg-zinc-50 p-3">
                  <p className="text-xs font-bold uppercase text-zinc-500">Proximas tareas programadas</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {nextDates.map((date) => (
                      <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-zinc-800 shadow-sm" key={date.toISOString()}>
                        {formatRecurringDate(date)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-zinc-600">
                    {nextDates[0] ? nextAssignmentMessage({ next_run_at: nextDates[0] }) : 'No hay una proxima fecha calculada.'}
                  </p>
                </div>
                {!rule.inferred ? (
                  <div className="mt-4 flex justify-end">
                    <button className="btn btn-soft" disabled={busy} onClick={() => deactivateRule(rule)}>
                      Desactivar repetitiva
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// Formulario para crear tareas normales o recurrentes.
function TaskCreator({ taskForm, setTaskForm, departments, activeProfiles, createTask, busy }) {
  const nextRun = taskForm.repeat ? nextRunFromForm(taskForm) : null;
  const nextRuns = taskForm.repeat ? nextRunsFromForm(taskForm) : [];

  function setFrequency(frequency) {
    setTaskForm({
      ...taskForm,
      frequency,
      weekdays: taskForm.weekdays.length ? taskForm.weekdays : ['2']
    });
  }

  function toggleWeekday(value) {
    const exists = taskForm.weekdays.includes(value);
    const next = exists ? taskForm.weekdays.filter((day) => day !== value) : [...taskForm.weekdays, value];
    setTaskForm({ ...taskForm, weekdays: next.length ? next : [value] });
  }

  return (
    <section className="panel p-4">
      <div className="mb-4 flex items-center gap-2">
        <Plus size={18} />
        <h2 className="text-lg font-bold">Crear tarea</h2>
      </div>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={createTask}>
        <input className="field md:col-span-2" placeholder="Nombre de tarea" value={taskForm.title} maxLength={MAX_TASK_TITLE_LENGTH} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} required />
        <textarea className="field md:col-span-2" placeholder="Descripcion opcional" value={taskForm.description} maxLength={MAX_TASK_DESCRIPTION_LENGTH} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} />
        <Select value={taskForm.department_id} onChange={(value) => setTaskForm({ ...taskForm, department_id: value })} options={departments.map((item) => [item.id, item.name])} />
        <Select value={taskForm.responsible_id} onChange={(value) => setTaskForm({ ...taskForm, responsible_id: value })} options={[['', 'Sin responsable'], ...activeProfiles.map((item) => [item.id, profileName(item)])]} />
        <Select value={taskForm.status} onChange={(value) => setTaskForm({ ...taskForm, status: value })} options={STATUSES} />
        <Select value={taskForm.priority} onChange={(value) => setTaskForm({ ...taskForm, priority: value })} options={PRIORITIES} />
        <input className="field" type="date" value={taskForm.start_date} onChange={(e) => setTaskForm({ ...taskForm, start_date: e.target.value })} />
        <input className="field" type="date" value={taskForm.due_date} onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })} />
        <label className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm">
          <input type="checkbox" checked={taskForm.repeat} onChange={(e) => setTaskForm({ ...taskForm, repeat: e.target.checked })} />
          Tarea repetitiva
        </label>
        {taskForm.repeat ? (
          <div className="grid gap-3 rounded-md border border-yellow-100 bg-yellow-50/50 p-3 md:col-span-2">
            <div className="grid gap-3 md:grid-cols-[1fr_220px] md:items-center">
              <p className="text-sm font-semibold text-zinc-700">Frecuencia de creacion automatica</p>
              <Select value={taskForm.frequency} onChange={setFrequency} options={FREQUENCIES} />
            </div>

            {taskForm.frequency === 'weekly' ? (
              <div className="rounded-md bg-white p-3">
                <p className="mb-3 text-sm font-bold text-zinc-700">Repetir los dias</p>
                <div className="flex flex-wrap gap-2">
                  {WEEK_DAYS.map(([value, short, name]) => (
                    <button
                      className={`h-10 w-10 rounded-full border text-sm font-black transition ${taskForm.weekdays.includes(value) ? 'border-yellow-400 bg-nomada-yellow text-zinc-950' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-900'}`}
                      key={value}
                      onClick={() => toggleWeekday(value)}
                      title={name}
                      type="button"
                    >
                      {short}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-sm font-semibold text-zinc-600">
                  Se repetira {joinList(WEEK_DAYS.filter(([value]) => taskForm.weekdays.includes(value)).map(([, , name]) => name.toLowerCase()))}.
                </p>
              </div>
            ) : null}

            {taskForm.frequency === 'monthly' ? (
              <div className="rounded-md bg-white p-3">
                <label className="grid gap-2 text-sm font-bold text-zinc-700 md:max-w-xs">
                  Dia del mes
                  <input className="field" min="1" max="31" type="number" value={taskForm.month_day} onChange={(event) => setTaskForm({ ...taskForm, month_day: event.target.value })} />
                </label>
                <p className="mt-3 text-sm font-semibold text-zinc-600">Se repetira el dia {taskForm.month_day || 1} de cada mes.</p>
              </div>
            ) : null}

            {taskForm.frequency === 'custom_interval' ? (
              <div className="rounded-md bg-white p-3">
                <label className="grid gap-2 text-sm font-bold text-zinc-700 md:max-w-xs">
                  Cada cuantos dias
                  <input className="field" min="1" type="number" value={taskForm.interval_days} onChange={(event) => setTaskForm({ ...taskForm, interval_days: event.target.value })} />
                </label>
                <p className="mt-3 text-sm font-semibold text-zinc-600">Se repetira cada {taskForm.interval_days || 1} dias.</p>
              </div>
            ) : null}

            {taskForm.frequency === 'weekly' && nextRuns.length > 1 ? (
              <div className="rounded-md bg-white px-3 py-2 text-sm text-zinc-600">
                <p className="font-bold text-zinc-700">Proximas tareas:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {nextRuns.map((date) => (
                    <span className="rounded-full bg-yellow-50 px-3 py-1 font-semibold text-yellow-800" key={date.toISOString()}>
                      {date.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-md bg-white px-3 py-2 text-sm text-zinc-600">
                Proxima tarea: <strong>{nextRun.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
              </p>
            )}
          </div>
        ) : null}
        <button className="btn btn-primary md:col-span-2" disabled={busy}>
          <Plus size={16} /> Guardar tarea
        </button>
      </form>
    </section>
  );
}

// Tabla principal de tareas con filtros y acciones rapidas.
function TaskBoard({ tasks, filters, setFilters, departments, departmentById, profileById, recurrenceByTaskId, assignableProfiles, openTask, updateTask, busy }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} />
          <h2 className="text-lg font-bold">Tablero de tareas</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
            <input className="field !pl-10" placeholder="Buscar" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          </label>
          <Select value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} options={[['', 'Todos los estados'], ...BOARD_STATUSES]} />
          <Select value={filters.department} onChange={(value) => setFilters({ ...filters, department: value })} options={[['', 'Todos los departamentos'], ...departments.map((item) => [item.id, item.name])]} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Tarea</th>
              <th className="px-4 py-3">Departamento</th>
              <th className="px-4 py-3">Responsable</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Prioridad</th>
              <th className="px-4 py-3">Inicio</th>
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
                  {task.is_recurring || recurrenceByTaskId[task.id] ? (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-bold text-yellow-700">
                      <RefreshCw size={11} /> Repetitiva
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">{departmentById[task.department_id]?.name ?? 'Sin depto'}</td>
                <td className="px-4 py-3">
                  <TaskFieldSelect
                    ariaLabel={`Cambiar responsable de ${task.title}`}
                    value={task.responsible_id ?? ''}
                    options={[['', 'Sin responsable'], ...assignableProfiles.map((item) => [item.id, profileName(item)])]}
                    disabled={busy}
                    onChange={(responsible_id) => updateTask(task, { responsible_id: responsible_id || null })}
                  />
                </td>
                <td className="px-4 py-3">
                  <TaskFieldSelect
                    ariaLabel={`Cambiar estado de ${task.title}`}
                    value={task.status}
                    options={STATUSES}
                    disabled={busy}
                    onChange={(status) => updateTask(task, { status })}
                  />
                </td>
                <td className="px-4 py-3">
                  <TaskFieldSelect
                    ariaLabel={`Cambiar prioridad de ${task.title}`}
                    value={task.priority}
                    options={PRIORITIES}
                    disabled={busy}
                    onChange={(priority) => updateTask(task, { priority })}
                  />
                </td>
                <td className="px-4 py-3">{task.start_date || '-'}</td>
                <td className="px-4 py-3">{task.due_date || '-'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button className="btn btn-soft" disabled={busy} onClick={() => updateTask(task, { status: 'completed' })} aria-label="Completar tarea">
                      <Check size={14} />
                    </button>
                    <button className="btn btn-soft" disabled={busy} onClick={() => updateTask(task, { status: 'archived' })} aria-label="Archivar tarea">
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

function CompletedTasksPanel({ tasks, departmentById, profileById, openTask, updateTask, busy }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 p-4">
        <div className="flex items-center gap-2">
          <Check size={18} />
          <h2 className="text-lg font-bold">Tareas completadas</h2>
        </div>
        <span className="rounded-md bg-green-50 px-3 py-1 text-sm font-semibold text-green-700">
          {tasks.length}
        </span>
      </div>
      {tasks.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Tarea</th>
                <th className="px-4 py-3">Departamento</th>
                <th className="px-4 py-3">Responsable</th>
                <th className="px-4 py-3">Completada</th>
                <th className="px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {tasks.map((task) => (
                <tr key={task.id} className="hover:bg-green-50/40">
                  <td className="px-4 py-3">
                    <button className="flex items-center gap-1 font-semibold text-zinc-950" onClick={() => openTask(task)}>
                      {task.title} <ChevronRight size={14} />
                    </button>
                  </td>
                  <td className="px-4 py-3">{departmentById[task.department_id]?.name ?? 'Sin depto'}</td>
                  <td className="px-4 py-3">{profileName(profileById[task.responsible_id], 'Sin responsable')}</td>
                  <td className="px-4 py-3">
                    {task.completed_at ? new Date(task.completed_at).toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button className="btn btn-soft" disabled={busy} onClick={() => updateTask(task, { status: 'in_progress' })} aria-label="Reabrir tarea">
                      <RefreshCw size={14} /> Reabrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-4 text-sm text-zinc-500">Todavia no hay tareas completadas.</p>
      )}
    </section>
  );
}

// Panel lateral con datos completos de la tarea seleccionada.
function TaskDetailModal({ task, comments, attachments, history, profileById, assignableProfiles, addComment, uploadAttachment, openAttachment, updateTask, busy, onClose }) {
  const [isEditing, setIsEditing] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [draft, setDraft] = useState({
    title: task.title,
    description: task.description || ''
  });

  async function saveTaskDraft() {
    const title = draft.title.trim();
    if (!title) return;
    await updateTask(task, {
      title,
      description: draft.description.trim() || null
    });
    setIsEditing(false);
    setShowActions(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/55 px-0 py-0 backdrop-blur-sm md:px-6 md:py-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="relative mx-auto flex h-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl md:rounded-[2rem]">
        <header className="flex items-center justify-between px-5 py-5 md:px-8">
          <button className="rounded-full p-2 text-zinc-800 transition hover:bg-zinc-100" onClick={onClose} aria-label="Volver">
            <ArrowLeft size={28} />
          </button>
          <div className="relative flex items-center gap-2">
            <button className="rounded-full p-2 text-zinc-800 transition hover:bg-zinc-100" aria-label="Mas opciones" onClick={() => setShowActions((current) => !current)}>
              <MoreHorizontal size={26} />
            </button>
            <button className="rounded-full p-2 text-zinc-800 transition hover:bg-zinc-100" onClick={onClose} aria-label="Cerrar">
              <X size={26} />
            </button>
            {showActions ? (
              <div className="absolute right-0 top-12 z-10 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white py-2 text-sm shadow-xl">
                <button className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-zinc-50" onClick={() => { setIsEditing(true); setShowActions(false); }}>
                  <Edit3 size={16} /> Editar titulo y descripcion
                </button>
                <button className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-zinc-50" onClick={() => updateTask(task, { status: 'completed' })}>
                  <Check size={16} /> Marcar completada
                </button>
                <button className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-zinc-50" onClick={() => updateTask(task, { status: 'archived' })}>
                  <Archive size={16} /> Archivar tarea
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 pb-28 md:px-10">
          {isEditing ? (
            <div className="space-y-4">
              <label className="grid gap-2 text-xs font-bold uppercase text-zinc-500">
                Titulo tarea
              <input
                className="w-full rounded-2xl border border-zinc-200 px-4 py-3 text-4xl font-black leading-tight outline-none focus:border-zinc-900 md:text-5xl"
                value={draft.title}
                maxLength={MAX_TASK_TITLE_LENGTH}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
              </label>
            </div>
          ) : (
            <div className="grid gap-2">
              <p className="text-xs font-bold uppercase text-zinc-500">Titulo tarea</p>
              <div className="group flex max-w-2xl items-start gap-3">
                <h2 className="min-w-0 text-5xl font-black leading-[1.08] tracking-normal text-zinc-900 md:text-6xl">
                  {task.title}
                </h2>
                <button
                  className="mt-2 rounded-full bg-zinc-100 p-2 text-zinc-500 opacity-0 transition hover:bg-zinc-900 hover:text-white focus:opacity-100 group-hover:opacity-100"
                  onClick={() => setIsEditing(true)}
                  aria-label="Editar titulo"
                >
                  <Edit3 size={18} />
                </button>
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-3 text-sm font-bold text-zinc-800">
              <ClipboardList size={18} />
              Responsable
            </span>
            <TaskFieldSelect
              ariaLabel={`Cambiar responsable de ${task.title}`}
              value={task.responsible_id ?? ''}
              options={[['', 'Sin responsable'], ...assignableProfiles.map((item) => [item.id, profileName(item)])]}
              disabled={busy}
              onChange={(responsible_id) => updateTask(task, { responsible_id: responsible_id || null })}
              large
            />
            <label className="grid gap-1 text-xs font-bold uppercase text-zinc-500">
              Estado
              <TaskFieldSelect
                ariaLabel={`Cambiar estado de ${task.title}`}
                value={task.status}
                options={STATUSES}
                disabled={busy}
                onChange={(status) => updateTask(task, { status })}
                large
              />
            </label>
            <label className="grid gap-1 text-xs font-bold uppercase text-zinc-500">
              Prioridad
              <TaskFieldSelect
                ariaLabel={`Cambiar prioridad de ${task.title}`}
                value={task.priority}
                options={PRIORITIES}
                disabled={busy}
                onChange={(priority) => updateTask(task, { priority })}
                large
              />
            </label>
          </div>

          <section className="mt-10">
            {isEditing ? (
              <div className="space-y-3">
                <label className="grid gap-2 text-xs font-bold uppercase text-zinc-500">
                  Descripcion tarea
                <textarea
                  className="min-h-56 w-full rounded-2xl border border-zinc-200 px-4 py-4 text-xl leading-relaxed outline-none focus:border-zinc-900"
                  value={draft.description}
                  maxLength={MAX_TASK_DESCRIPTION_LENGTH}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="Descripcion de la tarea..."
                />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-dark" onClick={saveTaskDraft} disabled={busy || !draft.title.trim()}>
                    <Save size={16} /> Guardar cambios
                  </button>
                  <button className="btn btn-soft" onClick={() => { setDraft({ title: task.title, description: task.description || '' }); setIsEditing(false); }} disabled={busy}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                <p className="text-xs font-bold uppercase text-zinc-500">Descripcion tarea</p>
                <div className="group flex items-start gap-3">
                  <button
                    className={`min-w-0 whitespace-pre-wrap text-left text-2xl leading-relaxed ${task.description ? 'text-zinc-800' : 'text-zinc-400'}`}
                    onClick={() => setIsEditing(true)}
                    type="button"
                  >
                    {task.description || 'Haz click para agregar descripcion'}
                  </button>
                  <button
                    className="mt-1 rounded-full bg-zinc-100 p-2 text-zinc-500 opacity-0 transition hover:bg-zinc-900 hover:text-white focus:opacity-100 group-hover:opacity-100"
                    onClick={() => setIsEditing(true)}
                    aria-label="Editar descripcion"
                  >
                    <Edit3 size={18} />
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="mt-12 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 p-4">
              <div className="mb-3 flex items-center gap-2 font-bold">
                <MessageSquare size={18} /> Comentarios
              </div>
              <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {comments.map((item) => (
                  <article className="rounded-xl bg-zinc-50 p-3 text-sm" key={item.id}>
                    <p className="font-bold text-zinc-900">{profileName(profileById[item.user_id])}</p>
                    <p className="mt-1 text-zinc-700">{item.comment}</p>
                    <p className="mt-2 text-xs text-zinc-400">{new Date(item.created_at).toLocaleString()}</p>
                  </article>
                ))}
                {!comments.length ? <p className="text-sm text-zinc-500">Aun no hay comentarios.</p> : null}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 p-4">
              <div className="mb-3 flex items-center gap-2 font-bold">
                <Paperclip size={18} /> Capturas y pruebas
              </div>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-600 transition hover:border-zinc-900 hover:bg-white">
                <Upload className="mb-2" size={24} />
                Subir captura, imagen o archivo de prueba
                <input className="hidden" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={uploadAttachment} disabled={busy} />
              </label>
              <div className="mt-4 space-y-2">
                {attachments.map((item) => (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 p-3 text-sm" key={item.id}>
                    <span className="min-w-0 truncate font-semibold">{item.file_name}</span>
                    <button className="btn btn-soft shrink-0 py-1" onClick={() => openAttachment(item)} disabled={busy}>
                      <ExternalLink size={14} /> Abrir
                    </button>
                  </div>
                ))}
                {!attachments.length ? <p className="text-sm text-zinc-500">Sin capturas o pruebas adjuntas.</p> : null}
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-zinc-200 p-4">
            <h3 className="mb-3 font-bold">Historial</h3>
            <div className="grid gap-2 text-sm text-zinc-600">
              {history.slice(0, 8).map((item) => (
                <p className="rounded-xl bg-zinc-50 p-3" key={item.id}>
                  {formatHistoryItem(item, profileById)} - {new Date(item.created_at).toLocaleString()}
                </p>
              ))}
              {!history.length ? <p>No hay historial todavia.</p> : null}
            </div>
          </section>
        </div>

        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-3xl bg-gradient-to-t from-white via-white to-white/0 px-5 pb-5 pt-10 md:px-8">
          <form className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 shadow-lg" onSubmit={addComment}>
            <MessageSquare className="ml-2 text-zinc-400" size={22} />
            <input className="min-w-0 flex-1 bg-transparent px-2 py-3 text-base outline-none" name="comment" placeholder="Anade comentario, avance o prueba..." maxLength={MAX_COMMENT_LENGTH} />
            <button className="btn btn-dark rounded-full" disabled={busy}>Enviar</button>
          </form>
        </div>
      </section>
    </div>
  );

  return (
    <section className="panel p-4">
      <h2 className="text-lg font-bold">{task.title}</h2>
      <p className="mt-1 text-sm text-zinc-600">{task.description || 'Sin descripcion.'}</p>
      <div className="mt-4 grid gap-2 text-sm">
        <span>Estado: <strong>{labelFrom(STATUSES, task.status)}</strong></span>
        <span>Prioridad: <strong>{labelFrom(PRIORITIES, task.priority)}</strong></span>
        <span>Responsable: <strong>{profileName(profileById[task.responsible_id], 'Sin responsable')}</strong></span>
      </div>

      <form className="mt-4 flex gap-2" onSubmit={addComment}>
        <input className="field" name="comment" placeholder="Agregar comentario" maxLength={MAX_COMMENT_LENGTH} />
        <button className="btn btn-dark">Enviar</button>
      </form>

      <label className="btn btn-soft mt-3 w-full cursor-pointer">
        <Paperclip size={16} /> Adjuntar archivo
        <input className="hidden" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={uploadAttachment} disabled={busy} />
      </label>

      <DetailList title="Comentarios" items={comments.map((item) => `${profileName(profileById[item.user_id])}: ${item.comment}`)} />
      <DetailList title="Archivos" items={attachments.map((item) => `${item.file_name} (${item.file_type ?? 'archivo'})`)} />
      <DetailList title="Historial" items={history.map((item) => `${formatHistoryItem(item, profileById)} · ${new Date(item.created_at).toLocaleString()}`)} />
    </section>
  );
}

function notificationLabel(type) {
  const labels = {
    department_task_created: 'Nueva tarea',
    task_assigned: 'Asignacion',
    comment_added: 'Comentario',
    description_changed: 'Descripcion',
    file_attached: 'Archivo',
    account_approved: 'Cuenta'
  };

  return labels[type] ?? 'Notificacion';
}

// Barra de notificaciones estilo red social con campana y bandeja desplegable.
function NotificationBell({ notifications, unreadCount, openNotification }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 transition hover:bg-zinc-200"
        onClick={() => setIsOpen((current) => !current)}
        aria-label="Abrir notificaciones"
        aria-expanded={isOpen}
        type="button"
      >
        <Bell size={20} />
        {unreadCount ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-center text-[11px] font-bold leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-12 z-40 w-[min(92vw,380px)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <h2 className="text-xl font-black text-zinc-950">Notificaciones</h2>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-600">
              {unreadCount} nuevas
            </span>
          </div>
          <div className="max-h-[28rem] overflow-y-auto py-2">
            {notifications.slice(0, 12).map((item) => (
              <button
                key={item.id}
                className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-zinc-50 ${item.is_read ? 'bg-white' : 'bg-yellow-50/70'}`}
                onClick={async () => {
                  await openNotification(item);
                  setIsOpen(false);
                }}
                type="button"
              >
                <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${item.is_read ? 'bg-zinc-300' : 'bg-blue-600'}`} />
                <span className="min-w-0">
                  <span className="block text-xs font-bold uppercase tracking-wide text-zinc-500">
                    {notificationLabel(item.type)}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold leading-snug text-zinc-900">
                    {item.message}
                  </span>
                  <span className="mt-1 block text-xs text-zinc-500">
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </span>
              </button>
            ))}
            {!notifications.length ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">No hay notificaciones por ahora.</p>
            ) : null}
          </div>
        </div>
      ) : null}
      </div>
  );
}

function SettingsPanel({
  profile,
  departments,
  settingsForm,
  setSettingsForm,
  updateOwnProfile,
  sendPasswordCode,
  updatePassword,
  requestDepartmentChange,
  canRequestDepartmentChange,
  busy,
  onClose
}) {
  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/45 backdrop-blur-sm">
      <aside className="ml-auto flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase text-yellow-600">Cuenta</p>
            <h2 className="text-xl font-black text-zinc-950">Ajustes</h2>
          </div>
          <button className="rounded-full p-2 text-zinc-700 hover:bg-zinc-100" onClick={onClose} aria-label="Cerrar ajustes">
            <X size={22} />
          </button>
        </header>

        <div className="grid gap-4 p-5">
          <form className="grid gap-3 rounded-md border border-zinc-200 p-4" onSubmit={updateOwnProfile}>
            <h3 className="font-bold text-zinc-950">Perfil</h3>
            <input
              className="field"
              placeholder="Nombre y apellido"
              value={settingsForm.name}
              maxLength={MAX_PROFILE_NAME_LENGTH}
              onChange={(event) => setSettingsForm({ ...settingsForm, name: event.target.value })}
              required
            />
            <input
              className="field"
              placeholder="Correo"
              type="email"
              value={settingsForm.email}
              onChange={(event) => setSettingsForm({ ...settingsForm, email: event.target.value })}
              required
            />
            <p className="text-xs text-zinc-500">
              El correo se actualiza en tu perfil interno. Para cambiar el correo de acceso, administracion debe validarlo.
            </p>
            <button className="btn btn-primary" disabled={busy}>
              <Save size={16} /> Guardar perfil
            </button>
          </form>

          <form className="grid gap-3 rounded-md border border-zinc-200 p-4" onSubmit={sendPasswordCode}>
            <h3 className="font-bold text-zinc-950">Contrasena</h3>
            <p className="text-sm text-zinc-600">Recibe un codigo en {profile?.email} para confirmar el cambio.</p>
            <button className="btn btn-soft" disabled={busy} type="submit">
              Enviar codigo
            </button>
          </form>

          <form className="grid gap-3 rounded-md border border-zinc-200 p-4" onSubmit={updatePassword}>
            <input
              className="field"
              placeholder="Codigo recibido"
              value={settingsForm.passwordCode}
              onChange={(event) => setSettingsForm({ ...settingsForm, passwordCode: event.target.value })}
              required
            />
            <input
              className="field"
              placeholder="Nueva contrasena"
              type="password"
              value={settingsForm.newPassword}
              onChange={(event) => setSettingsForm({ ...settingsForm, newPassword: event.target.value })}
              required
            />
            <button className="btn btn-dark" disabled={busy}>
              Cambiar contrasena
            </button>
          </form>

          {canRequestDepartmentChange ? (
            <form className="grid gap-3 rounded-md border border-yellow-100 bg-yellow-50/40 p-4" onSubmit={requestDepartmentChange}>
              <h3 className="font-bold text-zinc-950">Cambio de departamento</h3>
              <Select
                value={settingsForm.requestedDepartmentId}
                onChange={(value) => setSettingsForm({ ...settingsForm, requestedDepartmentId: value })}
                options={[['', 'Selecciona departamento'], ...departments.map((department) => [department.id, department.name])]}
              />
              <textarea
                className="field min-h-24"
                placeholder="Motivo o contexto para administracion"
                value={settingsForm.departmentReason}
                maxLength={MAX_COMMENT_LENGTH}
                onChange={(event) => setSettingsForm({ ...settingsForm, departmentReason: event.target.value })}
              />
              <button className="btn btn-primary" disabled={busy || !settingsForm.requestedDepartmentId}>
                Notificar a administracion
              </button>
            </form>
          ) : null}
        </div>
      </aside>
    </div>
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
        <Select value={adminForm.userId} onChange={(value) => setAdminForm({ ...adminForm, userId: value })} options={profiles.map((item) => [item.id, `${profileName(item)} · ${item.status}`])} />
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

function TaskFieldSelect({ ariaLabel, value, options, onChange, disabled, large = false }) {
  return (
    <select
      aria-label={ariaLabel}
      className={`field min-w-36 font-semibold ${large ? 'bg-white px-4 py-3 text-sm normal-case text-zinc-900' : 'py-1.5 text-xs'}`}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      {options.map(([key, label]) => (
        <option key={key} value={key}>
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
