// Archivo principal para las rutas
import express from 'express';
import pacienteRoutes from './pacienteRoutes.js';
import medicoRoutes from './medicoRoutes.js';
import turnoRoutes from './turnoRoutes.js';
import authRoutes from './authRoutes.js';

import Paciente from '../models/Paciente.js';
import Medico from '../models/Medico.js';
import Turno from '../models/Turno.js';
import DatabaseService from '../models/DatabaseService.js';
import { requireAuthView, requireRole } from '../middleware/index.js';

const router = express.Router();

// 🟢 Dashboard principal con datos reales desde DatabaseService
router.get('/', requireAuthView,requireRole(['Administrativo']), async (req, res) => {
  try {
    const turnos = await Turno.getTurnosCompletos();
    const pacientes = await Paciente.getAll();
    const medicos = await Medico.getAll();

    // Si querés limitar la cantidad mostrada
    const ultimosTurnos = turnos.slice(-10).reverse();
    const ultimosPacientes = pacientes.slice(-10).reverse();

    const turnosFormateados = ultimosTurnos.map(turno => {
        if (!turno.Fecha) {
            return { ...turno, fechaFormateada: 'Fecha no disp.' };
        }
        // Asegurarse que la fecha se interpreta correctamente como UTC
        const fecha = new Date(turno.Fecha);
        const dia = String(fecha.getUTCDate()).padStart(2, '0');
        const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
        const anio = fecha.getUTCFullYear();
        return {
            ...turno,
            fechaFormateada: `${dia}/${mes}/${anio}`
        };
    });

    res.render('index', {
      title: 'Dashboard - Clínica Salud Integral',
      turnos: turnosFormateados,
      pacientes: ultimosPacientes,
      medicos,
      metrics: {
        turnos: turnos.length,
        pacientes: pacientes.length,
        medicos: medicos.length
      },
      user: req.session?.user || null
    });
  } catch (error) {
    console.error('Error cargando datos del dashboard:', error);
    res.render('index', {
      title: 'Dashboard - Clínica Salud Integral',
      turnos: [],
      pacientes: [],
      medicos: [],
      metrics: { turnos: 0, pacientes: 0, medicos: 0 },
      error: 'Error al obtener datos de la base de datos',
      user: req.session?.user || null
    });
  }
});

// 🩺 Rutas para vistas individuales
router.get('/pacientes', requireAuthView, (req, res) => {
  res.render('pacientes', { title: 'Gestión de Pacientes', user: req.session?.user || null });
});

router.get('/medicos', requireAuthView, (req, res) => {
  res.render('medicos', { title: 'Gestión de Médicos', user: req.session?.user || null });
});

router.get('/turnos', requireAuthView, (req, res) => {
  res.render('turnos', { title: 'Gestión de Turnos', user: req.session?.user || null });
});

// Dashboards específicos por rol
router.get('/dashboard/medico', requireAuthView, async (req, res) => {
  const user = req.session?.user || null;
  if (!user || user.role !== 'Medico' || !user.medicoId) {
    return res.redirect('/login');
  }
  try {
    const turnosCompletos = await Turno.getTurnosCompletos();
    const misTurnos = turnosCompletos.filter(t => t.IdMedico && t.IdMedico.toString() === user.medicoId.toString());
    const now = new Date();

    const proximos = misTurnos
      .filter(t => {
        // Construir fecha-hora combinada para comparar con "ahora"
        const fechaBase = new Date(t.Fecha);
        let dt = fechaBase;
        if (t.HoraInicio) {
          const y = fechaBase.getUTCFullYear();
          const m = String(fechaBase.getUTCMonth() + 1).padStart(2, '0');
          const d = String(fechaBase.getUTCDate()).padStart(2, '0');
          const isoFecha = `${y}-${m}-${d}`;
          const combinado = new Date(`${isoFecha}T${t.HoraInicio}:00`);
          if (!isNaN(combinado)) dt = combinado;
        }
        return dt >= now;
      })
      .sort((a, b) => {
        const fa = new Date(a.Fecha);
        const fb = new Date(b.Fecha);
        let da = fa;
        let db = fb;
        if (a.HoraInicio) {
          const ya = fa.getUTCFullYear();
          const ma = String(fa.getUTCMonth() + 1).padStart(2, '0');
          const da0 = String(fa.getUTCDate()).padStart(2, '0');
          const isoA = `${ya}-${ma}-${da0}`;
          const ca = new Date(`${isoA}T${a.HoraInicio}:00`);
          if (!isNaN(ca)) da = ca;
        }
        if (b.HoraInicio) {
          const yb = fb.getUTCFullYear();
          const mb = String(fb.getUTCMonth() + 1).padStart(2, '0');
          const db0 = String(fb.getUTCDate()).padStart(2, '0');
          const isoB = `${yb}-${mb}-${db0}`;
          const cb = new Date(`${isoB}T${b.HoraInicio}:00`);
          if (!isNaN(cb)) db = cb;
        }
        return da - db;
      });

    // Formatear la fecha sin desfase de zona horaria (usar componentes UTC)
    const formatFechaUTC = (fecha) => {
      const d = new Date(fecha);
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const yyyy = d.getUTCFullYear();
      return `${dd}-${mm}-${yyyy}`;
    };

    const proximosFormateados = proximos.map(t => ({
      ...t,
      FechaStr: formatFechaUTC(t.Fecha)
    }));

    res.render('dashboardMedico', {
      title: 'Dashboard Médico',
      user,
      turnos: proximosFormateados,
      metrics: { turnos: proximosFormateados.length }
    });
  } catch (error) {
    console.error('Error cargando dashboard médico:', error);
    res.render('dashboardMedico', {
      title: 'Dashboard Médico',
      user,
      turnos: [],
      metrics: { turnos: 0 }
    });
  }
});

router.get('/dashboard/paciente', requireAuthView, async (req, res) => {
  const user = req.session?.user || null;
  if (!user || user.role !== 'Paciente' || !user.pacienteId) {
    return res.redirect('/');
  }
  try {
    const turnosCompletos = await Turno.getTurnosCompletos();
    const misTurnos = turnosCompletos.filter(t => t.IdPaciente && t.IdPaciente.toString() === user.pacienteId.toString());

    const now = new Date();
    const proximos = misTurnos
      .filter(t => {
        const fechaBase = new Date(t.Fecha);
        let dt = fechaBase;
        if (t.HoraInicio) {
          const y = fechaBase.getUTCFullYear();
          const m = String(fechaBase.getUTCMonth() + 1).padStart(2, '0');
          const d = String(fechaBase.getUTCDate()).padStart(2, '0');
          const isoFecha = `${y}-${m}-${d}`;
          const combinado = new Date(`${isoFecha}T${t.HoraInicio}:00`);
          if (!isNaN(combinado)) dt = combinado;
        }
        return dt >= now;
      })
      .sort((a, b) => {
        const fa = new Date(a.Fecha);
        const fb = new Date(b.Fecha);
        let da = fa;
        let db = fb;
        if (a.HoraInicio) {
          const ya = fa.getUTCFullYear();
          const ma = String(fa.getUTCMonth() + 1).padStart(2, '0');
          const da0 = String(fa.getUTCDate()).padStart(2, '0');
          const isoA = `${ya}-${ma}-${da0}`;
          const ca = new Date(`${isoA}T${a.HoraInicio}:00`);
          if (!isNaN(ca)) da = ca;
        }
        if (b.HoraInicio) {
          const yb = fb.getUTCFullYear();
          const mb = String(fb.getUTCMonth() + 1).padStart(2, '0');
          const db0 = String(fb.getUTCDate()).padStart(2, '0');
          const isoB = `${yb}-${mb}-${db0}`;
          const cb = new Date(`${isoB}T${b.HoraInicio}:00`);
          if (!isNaN(cb)) db = cb;
        }
        return da - db;
      });

    // Formatear fecha usando componentes UTC para evitar desfase de un día
    const formatFechaUTC = (fecha) => {
      const d = new Date(fecha);
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const yyyy = d.getUTCFullYear();
      return `${dd}-${mm}-${yyyy}`;
    };

    const misTurnosFormateados = proximos.map(t => ({
      ...t,
      FechaStr: formatFechaUTC(t.Fecha)
    }));

    res.render('dashboardPaciente', {
      title: 'Mi Dashboard',
      user,
      turnos: misTurnosFormateados,
      metrics: { turnos: misTurnosFormateados.length }
    });
  } catch (error) {
    console.error('Error cargando dashboard paciente:', error);
    res.render('dashboardPaciente', {
      title: 'Mi Dashboard',
      user,
      turnos: [],
      metrics: { turnos: 0 },
      error: 'Error al obtener datos'
    });
  }
});

router.get('/usuarios', requireAuthView, (req, res) => {
  const user = req.session?.user || null;
  if (!user || user.role !== 'Administrativo') {
    return res.redirect('/');
  }
  res.render('usuarios', { title: 'Gestión de Usuarios', user });
});
// Página de Login
router.get('/login', (req, res) => {
  const user = req.session?.user || null;
  if (user) {
    // Redirección por rol si ya está autenticado
    if (user.role === 'Administrativo') return res.redirect('/');
    if (user.role === 'Medico') return res.redirect('/dashboard/medico');
    if (user.role === 'Paciente') return res.redirect('/dashboard/paciente');
  }
  res.render('login', { title: 'Iniciar Sesión', user: null });
});

// Registro público de Paciente
router.get('/registro/paciente', (req, res) => {
  const googleEmail = req.query.googleEmail || '';
  const googleFirstName = req.query.googleFirstName || '';
  const googleLastName = req.query.googleLastName || '';
  res.render('registroPaciente', { title: 'Registro de Paciente', user: null, googleEmail, googleFirstName, googleLastName });
})
// 🧠 Estado de la API
router.get('/api/status', (req, res) => {
  res.json({
    status: 'success',
    message: 'API funcionando correctamente',
    timestamp: new Date().toISOString(),
    database: 'MongoDB Atlas',
    endpoints: {
      pacientes: '/api/pacientes',
      medicos: '/api/medicos',
      turnos: '/api/turnos',
      status: '/api/status'
    }
  });
});

// Rutas API
router.use('/api/pacientes', pacienteRoutes);
router.use('/api/medicos', medicoRoutes);
router.use('/api/turnos', turnoRoutes);
router.use('/api/auth', authRoutes);

export default router;