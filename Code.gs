// ============================================================
//  Gestion Financiero — Code.gs
//  Google Apps Script + Firebase Firestore
// ============================================================

// ============================================================
//  SECRETOS - Propiedades del script (NUNCA en el codigo fuente)
// ============================================================
// FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY y
// USERS_SPREADSHEET_ID son credenciales/identificadores privados y NO se
// guardan aqui. Configuralos en:
//   Extensiones > Apps Script > (icono engranaje) Configuracion del proyecto
//   > Propiedades del script > Agregar propiedad de script
// con esos 4 nombres exactos. getScriptProperty_() los lee desde ahi en
// tiempo de ejecucion, para que nunca queden guardados en Code.gs ni se
// suban por accidente a un repositorio de git.
function getScriptProperty_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error('Falta configurar la propiedad de script "' + key + '". Ve a Extensiones > Apps Script > Configuracion del proyecto > Propiedades del script.');
  }
  return value;
}

var CONFIG = {
  // -- Google Sheets (Usuarios) --
  USERS_SHEET_NAME:     'Usuarios',
  ADMIN_EMAIL:          'ccortes@ingenieroelm.com',

  // -- Cuenta Demo (compartida, para visitantes antes de iniciar sesion) --
  DEMO_USER_ID:   'demo@gestionfinanciera.app',
  DEMO_USER_NAME: 'Cuenta Demo',

  // -- Colecciones de Firestore --
  COLLECTION_CUENTAS:        'cuentas',
  COLLECTION_INGRESOS:       'ingresos',
  COLLECTION_GASTOS:         'gastos',
  COLLECTION_TRANSFERENCIAS: 'transferencias',
  COLLECTION_CATEGORIAS:     'categorias',
  COLLECTION_PRESUPUESTOS:        'presupuestos',
  COLLECTION_GASTOS_PERIODO:      'gastos_periodo',
  COLLECTION_HISTORIAL_PERIODO:   'historial_periodo',

  // -- Categorias por defecto --
  CATEGORIAS_DEFECTO: [
    'Vivienda', 'Servicios', 'Alimentacion', 'Transporte',
    'Salud', 'Entretenimiento', 'Educacion', 'Ahorro',
    'Tarjetas', 'Prestamos', 'Telefono', 'Internet', 'Otros'
  ],

  // -- Frecuencias de ingreso --
  FRECUENCIAS_INGRESO: ['Semanal', 'Bisemanal', 'Quincenal', 'Mensual', 'Anual', 'Unico']
};

// ============================================================
//  WEB APP - Punto de entrada
// ============================================================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Gestion Financiero')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ============================================================
//  GOOGLE SHEETS - Usuarios (Autenticacion)
// ============================================================
function getUsersSheet_() {
  var ss = SpreadsheetApp.openById(getScriptProperty_('USERS_SPREADSHEET_ID'));
  var sheet = ss.getSheetByName(CONFIG.USERS_SHEET_NAME);
  if (!sheet) {
    sheet = setupUsuariosSheet();

  }
  return sheet;
}

function setupUsuariosSheet() {
  var ss = SpreadsheetApp.openById(getScriptProperty_('USERS_SPREADSHEET_ID'));

  var existing = ss.getSheetByName(CONFIG.USERS_SHEET_NAME);
  if (existing) {
    var existingRows = existing.getLastRow();
    if (existingRows > 1) {
      Logger.log('Hoja Usuarios ya existe con ' + (existingRows - 1) + ' usuarios. No se sobreescribio.');
      return existing;
    }
    ss.deleteSheet(existing);
  }

  var sheet = ss.insertSheet(CONFIG.USERS_SHEET_NAME);

  var headers = ['id', 'email', 'nombre', 'rol', 'activo', 'fecha_registro'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#1e3a5f')
    .setFontColor('#ffffff');

  var now = new Date().toISOString();

  sheet.appendRow(['usr_' + Date.now(),       'ccortes@ingenieroelm.com', 'Cristina Cortes', 'admin',   'TRUE', now]);
  sheet.appendRow(['usr_' + (Date.now() + 1), 'ismaelrt.1542@gmail.com',  'Ismael RT',       'cliente', 'TRUE', now]);

  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 240);
  sheet.setColumnWidth(3, 180);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 80);
  sheet.setColumnWidth(6, 200);
  sheet.setFrozenRows(1);

  Logger.log('Hoja Usuarios creada con 2 usuarios.');
  return sheet;
}

function getCurrentUser() {
  try {
    var email = Session.getActiveUser().getEmail();
    if (!email) email = Session.getEffectiveUser().getEmail();

    if (!email) {
      return { authenticated: false, error: 'No se pudo obtener el email del usuario. Por favor abre la URL en una ventana nueva e inicia sesion con tu cuenta de Google.' };
    }

    var isAdmin = (email.toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase());

    var user = null;

    var sheetsAccessible = true;

    try {
      var sheet = getUsersSheet_();
      var data = sheet.getDataRange().getValues();
      var headers = data[0];
      var emailCol   = headers.indexOf('email');
      var nombreCol  = headers.indexOf('nombre');
      var rolCol     = headers.indexOf('rol');
      var activoCol  = headers.indexOf('activo');

      for (var i = 1; i < data.length; i++) {
        if (data[i][emailCol] && data[i][emailCol].toString().toLowerCase() === email.toLowerCase()) {
          user = {
            row: i + 1,
            email:  data[i][emailCol],
            nombre: data[i][nombreCol] || email.split('@')[0],
            rol:    data[i][rolCol]    || 'cliente',
            activo: data[i][activoCol] === true || data[i][activoCol] === 'TRUE' || data[i][activoCol] === 'true'
          };
          break;
        }
      }

      if (isAdmin && !user) {
        sheet.appendRow(['usr_' + Date.now(), email, 'Administrador', 'admin', 'TRUE', new Date().toISOString()]);
        user = { email: email, nombre: 'Administrador', rol: 'admin', activo: true };
      }
    } catch (sheetsError) {
      Logger.log('Sheets access error: ' + sheetsError.toString());
      sheetsAccessible = false;

      var FALLBACK_USERS = {
        'ccortes@ingenieroelm.com': { nombre: 'Cristina Cortes', rol: 'admin',   activo: true },
        'ismaelrt.1542@gmail.com':  { nombre: 'Ismael RT',       rol: 'cliente', activo: true }
      };

      var fallback = FALLBACK_USERS[email.toLowerCase()];
      if (fallback) {
        return { authenticated: true, email: email, nombre: fallback.nombre, rol: fallback.rol, isAdmin: fallback.rol === 'admin' };
      }
      return { authenticated: false, error: 'Usuario no autorizado. Contacte al administrador.' };
    }

    if (isAdmin) {
      return { authenticated: true, email: email, nombre: user ? user.nombre : 'Cristina Cortes', rol: 'admin', isAdmin: true };
    }
    if (!user)        return { authenticated: false, error: 'Usuario no autorizado. Contacte al administrador.' };
    if (!user.activo) return { authenticated: false, error: 'Usuario desactivado. Contacte al administrador.' };

    return { authenticated: true, email: user.email, nombre: user.nombre, rol: user.rol, isAdmin: user.rol === 'admin' };
  } catch (e) {
    var email2 = Session.getActiveUser().getEmail();
    if (email2 && email2.toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase()) {
      return { authenticated: true, email: email2, nombre: 'Administrador', rol: 'admin', isAdmin: true, error: e.toString() };

    }
    return { authenticated: false, error: e.toString() };
  }
}

// ============================================================
//  MODO DEMO - contexto compartido para visitantes sin cuenta
// ============================================================
// Cuando modoDemo es true, todas las operaciones de datos (cuentas,
// ingresos, gastos, presupuesto, etc.) se resuelven contra una cuenta
// "demo@gestionfinanciera.app" compartida por todos los visitantes,
// separada por completo de los datos reales de cada usuario. No requiere
// haber iniciado sesion con Google ni estar en la hoja de Usuarios.
function resolveContext_(modoDemo) {
  if (modoDemo) {
    return {
      authenticated: true,
      email: CONFIG.DEMO_USER_ID,
      nombre: CONFIG.DEMO_USER_NAME,
      rol: 'demo',
      isAdmin: false,
      isDemo: true
    };
  }
  return getCurrentUser();
}

// Confirma que el documento indicado pertenece al usuario actual antes de
// permitir editarlo o borrarlo (evita que un usuario modifique datos de otro
// adivinando su ID de documento).
function verificarPropietario_(collection, id, usuarioEmail) {
  try {
    var doc = firestoreRequest_('GET', '/' + collection + '/' + id);
    var obj = parseFirestoreDoc_(doc);
    return !!(obj && obj.usuario_id === usuarioEmail);
  } catch (e) {
    return false;
  }
}

function getProfile(modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    return { success: true, profile: { email: user.email, nombre: user.nombre, rol: user.rol, isAdmin: user.isAdmin, isDemo: !!user.isDemo } };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============================================================
//  USUARIOS CRUD (Solo Admin) - Google Sheets
// ============================================================
function getAllUsuarios() {
  try {
    var user = getCurrentUser();
    if (!user.authenticated) return { success: false, error: user.error };
    if (!user.isAdmin) return { success: false, error: 'Solo administradores pueden ver usuarios' };

    var sheet   = getUsersSheet_();
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var usuarios = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[0]) {
        usuarios.push({
          id:              (i + 1).toString(),
          email:           row[headers.indexOf('email')]           || '',
          nombre:          row[headers.indexOf('nombre')]          || '',
          rol:             row[headers.indexOf('rol')]             || 'cliente',
          activo:          row[headers.indexOf('activo')] === true || row[headers.indexOf('activo')] === 'TRUE' || row[headers.indexOf('activo')] === 'true',
          fecha_registro:  row[headers.indexOf('fecha_registro')]  || ''
        });
      }
    }
    return { success: true, usuarios: usuarios };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function createUsuario(data) {
  try {
    var user = getCurrentUser();
    if (!user.authenticated) return { success: false, error: user.error };
    if (!user.isAdmin) return { success: false, error: 'Solo administradores pueden crear usuarios' };
    if (!data.email) return { success: false, error: 'Email es requerido' };

    var sheet        = getUsersSheet_();
    var existingData = sheet.getDataRange().getValues();

    for (var i = 1; i < existingData.length; i++) {
      if (existingData[i][0] && existingData[i][0].toString().toLowerCase() === data.email.toLowerCase()) {
        return { success: false, error: 'El usuario ya existe' };
      }
    }

    sheet.appendRow([
      data.email,
      data.nombre || data.email.split('@')[0],
      data.rol    || 'cliente',
      data.activo !== false ? 'TRUE' : 'FALSE',
      new Date().toISOString()
    ]);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function updateUsuario(id, data) {
  try {
    var user = getCurrentUser();
    if (!user.authenticated) return { success: false, error: user.error };
    if (!user.isAdmin) return { success: false, error: 'Solo administradores pueden editar usuarios' };

    var rowNum = parseInt(id);
    if (isNaN(rowNum) || rowNum < 2) return { success: false, error: 'Usuario no encontrado' };

    var sheet   = getUsersSheet_();
    var headers = sheet.getRange(1, 1, 1, 6).getValues()[0];
    var row     = sheet.getRange(rowNum, 1, 1, 6).getValues()[0];

    if (row[headers.indexOf('email')] && row[headers.indexOf('email')].toString().toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase()) {
      if (data.activo === false || data.rol !== 'admin') {
        return { success: false, error: 'No se puede desactivar ni cambiar el rol del administrador principal' };
      }
    }

    if (data.nombre  !== undefined) sheet.getRange(rowNum, headers.indexOf('nombre')  + 1).setValue(data.nombre);
    if (data.rol     !== undefined) sheet.getRange(rowNum, headers.indexOf('rol')      + 1).setValue(data.rol);
    if (data.activo  !== undefined) sheet.getRange(rowNum, headers.indexOf('activo')   + 1).setValue(data.activo ? 'TRUE' : 'FALSE');

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function deleteUsuario(id) {
  try {
    var user = getCurrentUser();
    if (!user.authenticated) return { success: false, error: user.error };

    if (!user.isAdmin) return { success: false, error: 'Solo administradores pueden eliminar usuarios' };

    var rowNum = parseInt(id);
    if (isNaN(rowNum) || rowNum < 2) return { success: false, error: 'Usuario no encontrado' };

    var sheet = getUsersSheet_();
    var row   = sheet.getRange(rowNum, 1, 1, 6).getValues()[0];

    if (row[0] && row[0].toString().toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase()) {
      return { success: false, error: 'No se puede eliminar el administrador principal' };
    }

    sheet.deleteRow(rowNum);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============================================================
//  CUENTAS BANCARIAS - CRUD (Firebase)
// ============================================================
function getCuentas(modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var docs    = firestoreGetAll_(CONFIG.COLLECTION_CUENTAS);
    var cuentas = docs.map(function(doc){ return parseFirestoreDoc_(doc); })
                      .filter(function(c){ return c && c.activo !== false && c.usuario_id === user.email; });
    var total   = cuentas.reduce(function(s,c){ return s + (parseFloat(c.saldo)||0); }, 0);

    return { success: true, cuentas: cuentas, total: total };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function addCuenta(data, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var cuenta = {
      nombre: data.nombre || '', saldo: parseFloat(data.saldo) || 0,
      icono: data.icono || '🏦', color: data.color || '#4f46e5',
      notas: data.notas || '', tipo: data.tipo || 'corriente',
      activo: true, fecha_creacion: new Date().toISOString(), creado_por: user.email,
      usuario_id: user.email
    };

    var response = firestoreRequest_('POST', '/' + CONFIG.COLLECTION_CUENTAS, { fields: objectToFirestore_(cuenta) });
    return { success: true, id: response.name ? response.name.split('/').pop() : null };
  } catch (e) {
    return { success: false, error: e.toString() };
  }

}

function updateCuenta(id, data, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    if (!verificarPropietario_(CONFIG.COLLECTION_CUENTAS, id, user.email)) return { success: false, error: 'No autorizado para modificar esta cuenta' };

    var fields = {}, updateFields = [];
    if (data.nombre    !== undefined) { fields.nombre    = toFirestoreValue_(data.nombre);                    updateFields.push('nombre'); }
    if (data.saldo     !== undefined) { fields.saldo     = toFirestoreValue_(parseFloat(data.saldo)||0);      updateFields.push('saldo'); }
    if (data.icono     !== undefined) { fields.icono     = toFirestoreValue_(data.icono);                     updateFields.push('icono'); }
    if (data.color     !== undefined) { fields.color     = toFirestoreValue_(data.color);                     updateFields.push('color'); }
    if (data.notas     !== undefined) { fields.notas     = toFirestoreValue_(data.notas);                     updateFields.push('notas'); }
    if (data.tipo      !== undefined) { fields.tipo      = toFirestoreValue_(data.tipo);                      updateFields.push('tipo'); }

    var mask = updateFields.map(function(f){ return 'updateMask.fieldPaths=' + f; }).join('&');
    firestoreRequest_('PATCH', '/' + CONFIG.COLLECTION_CUENTAS + '/' + id + '?' + mask, { fields: fields });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function deleteCuenta(id, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    if (!verificarPropietario_(CONFIG.COLLECTION_CUENTAS, id, user.email)) return { success: false, error: 'No autorizado para eliminar esta cuenta' };
    firestoreRequest_('PATCH', '/' + CONFIG.COLLECTION_CUENTAS + '/' + id + '?updateMask.fieldPaths=activo', { fields: { activo: toFirestoreValue_(false) } });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============================================================
//  INGRESOS - CRUD (Firebase)
// ============================================================
function getIngresos(modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var docs     = firestoreGetAll_(CONFIG.COLLECTION_INGRESOS);
    var ingresos = docs.map(function(doc){ return parseFirestoreDoc_(doc); })
                       .filter(function(i){ return i && i.activo !== false && i.usuario_id === user.email; });

    var totalMensual = ingresos.reduce(function(s, i) {
      if (!i.activo_recurrente) return s;
      var m = parseFloat(i.monto) || 0;
      switch (i.frecuencia) {
        case 'Semanal':   return s + (m * 4);
        case 'Bisemanal': return s + (m * 2);
        case 'Quincenal': return s + (m * 2);
        case 'Mensual':   return s + m;
        case 'Anual':     return s + (m / 12);

        default:          return s;
      }
    }, 0);

    return { success: true, ingresos: ingresos, totalMensual: totalMensual };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function addIngreso(data, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var ingreso = {
      nombre: data.nombre || '', monto: parseFloat(data.monto) || 0,
      frecuencia: data.frecuencia || 'Mensual', dia_cobro: parseInt(data.dia_cobro) || 1,
      cuenta_destino: data.cuenta_destino || '', cuenta_destino_id: data.cuenta_destino_id || '',
      activo_recurrente: data.activo_recurrente !== false, notas: data.notas || '',
      activo: true, fecha_creacion: new Date().toISOString(), creado_por: user.email,
      usuario_id: user.email
    };

    var response = firestoreRequest_('POST', '/' + CONFIG.COLLECTION_INGRESOS, { fields: objectToFirestore_(ingreso) });
    return { success: true, id: response.name ? response.name.split('/').pop() : null };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function updateIngreso(id, data, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    if (!verificarPropietario_(CONFIG.COLLECTION_INGRESOS, id, user.email)) return { success: false, error: 'No autorizado para modificar este ingreso' };

    var fields = {}, updateFields = [];
    if (data.nombre             !== undefined) { fields.nombre             = toFirestoreValue_(data.nombre);                        updateFields.push('nombre'); }
    if (data.monto              !== undefined) { fields.monto              = toFirestoreValue_(parseFloat(data.monto)||0);          updateFields.push('monto'); }
    if (data.frecuencia         !== undefined) { fields.frecuencia         = toFirestoreValue_(data.frecuencia);                    updateFields.push('frecuencia'); }
    if (data.dia_cobro          !== undefined) { fields.dia_cobro          = toFirestoreValue_(parseInt(data.dia_cobro)||1);        updateFields.push('dia_cobro'); }
    if (data.cuenta_destino     !== undefined) { fields.cuenta_destino     = toFirestoreValue_(data.cuenta_destino);                updateFields.push('cuenta_destino'); }
    if (data.cuenta_destino_id  !== undefined) { fields.cuenta_destino_id  = toFirestoreValue_(data.cuenta_destino_id);             updateFields.push('cuenta_destino_id'); }
    if (data.activo_recurrente  !== undefined) { fields.activo_recurrente  = toFirestoreValue_(data.activo_recurrente);             updateFields.push('activo_recurrente'); }
    if (data.notas              !== undefined) { fields.notas              = toFirestoreValue_(data.notas);                        updateFields.push('notas'); }

    var mask = updateFields.map(function(f){ return 'updateMask.fieldPaths=' + f; }).join('&');
    firestoreRequest_('PATCH', '/' + CONFIG.COLLECTION_INGRESOS + '/' + id + '?' + mask, { fields: fields });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function deleteIngreso(id, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    if (!verificarPropietario_(CONFIG.COLLECTION_INGRESOS, id, user.email)) return { success: false, error: 'No autorizado para eliminar este ingreso' };
    firestoreRequest_('PATCH', '/' + CONFIG.COLLECTION_INGRESOS + '/' + id + '?updateMask.fieldPaths=activo', { fields: { activo: toFirestoreValue_(false) } });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function registrarIngresoRecibido(ingresoId, data, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    if (!verificarPropietario_(CONFIG.COLLECTION_INGRESOS, ingresoId, user.email)) return { success: false, error: 'No autorizado para registrar este ingreso' };

    var ingresoDoc = firestoreRequest_('GET', '/' + CONFIG.COLLECTION_INGRESOS + '/' + ingresoId);
    var ingreso    = parseFirestoreDoc_(ingresoDoc);
    if (!ingreso) return { success: false, error: 'Ingreso no encontrado' };

    var monto    = parseFloat(data.monto) || parseFloat(ingreso.monto) || 0;
    var cuentaId = data.cuenta_destino_id || ingreso.cuenta_destino_id;

    if (cuentaId) {
      var cuentaDoc = firestoreRequest_('GET', '/' + CONFIG.COLLECTION_CUENTAS + '/' + cuentaId);
      var cuenta    = parseFirestoreDoc_(cuentaDoc);
      if (cuenta) updateCuenta(cuentaId, { saldo: (parseFloat(cuenta.saldo)||0) + monto }, modoDemo);
    }

    firestoreRequest_('POST', '/' + CONFIG.COLLECTION_TRANSFERENCIAS, {
      fields: objectToFirestore_({
        fecha: data.fecha || new Date().toISOString().split('T')[0],
        tipo: 'ingreso', desde_cuenta: '',
        hacia_cuenta: data.cuenta_destino || ingreso.cuenta_destino || '',
        hacia_cuenta_id: cuentaId, monto: monto, categoria: 'Ingreso',
        descripcion: ingreso.nombre + (data.notas ? ' - ' + data.notas : ''),
        referencia_id: ingresoId, registrado_por: user.email,
        fecha_registro: new Date().toISOString(), usuario_id: user.email
      })
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============================================================
//  GASTOS / FACTURAS - CRUD (Firebase)
// ============================================================
function getGastos(modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var docs   = firestoreGetAll_(CONFIG.COLLECTION_GASTOS);
    var gastos = docs.map(function(doc){ return parseFirestoreDoc_(doc); })
                     .filter(function(g){ return g && g.activo !== false && g.usuario_id === user.email; });

    var totalFacturas = 0, totalPagado = 0, totalPendiente = 0;
    gastos.forEach(function(g) {
      var m = parseFloat(g.monto) || 0;
      totalFacturas += m;
      if (g.pagado) totalPagado += m; else totalPendiente += m;
    });

    return { success: true, gastos: gastos, totalFacturas: totalFacturas, totalPagado: totalPagado, totalPendiente: totalPendiente };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function addGasto(data, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var gasto = {
      nombre: data.nombre || '', monto: parseFloat(data.monto) || 0,
      dia_vence: parseInt(data.dia_vence) || 1, categoria: data.categoria || 'Otros',
      cuenta: data.cuenta || '', cuenta_id: data.cuenta_id || '',
      pagado: data.pagado || false, fecha_pago: data.fecha_pago || '',
      recurrente: data.recurrente !== false, notas: data.notas || '',
      activo: true, fecha_creacion: new Date().toISOString(), creado_por: user.email,
      usuario_id: user.email
    };

    var response = firestoreRequest_('POST', '/' + CONFIG.COLLECTION_GASTOS, { fields: objectToFirestore_(gasto) });
    return { success: true, id: response.name ? response.name.split('/').pop() : null };
  } catch (e) {
    return { success: false, error: e.toString() };

  }
}

function updateGasto(id, data, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    if (!verificarPropietario_(CONFIG.COLLECTION_GASTOS, id, user.email)) return { success: false, error: 'No autorizado para modificar este gasto' };

    var fields = {}, updateFields = [];
    if (data.nombre     !== undefined) { fields.nombre     = toFirestoreValue_(data.nombre);                  updateFields.push('nombre'); }
    if (data.monto      !== undefined) { fields.monto      = toFirestoreValue_(parseFloat(data.monto)||0);    updateFields.push('monto'); }
    if (data.dia_vence  !== undefined) { fields.dia_vence  = toFirestoreValue_(parseInt(data.dia_vence)||1);  updateFields.push('dia_vence'); }
    if (data.categoria  !== undefined) { fields.categoria  = toFirestoreValue_(data.categoria);               updateFields.push('categoria'); }
    if (data.cuenta     !== undefined) { fields.cuenta     = toFirestoreValue_(data.cuenta);                  updateFields.push('cuenta'); }
    if (data.cuenta_id  !== undefined) { fields.cuenta_id  = toFirestoreValue_(data.cuenta_id);               updateFields.push('cuenta_id'); }
    if (data.pagado     !== undefined) { fields.pagado     = toFirestoreValue_(data.pagado);                  updateFields.push('pagado'); }
    if (data.fecha_pago !== undefined) { fields.fecha_pago = toFirestoreValue_(data.fecha_pago);              updateFields.push('fecha_pago'); }
    if (data.recurrente !== undefined) { fields.recurrente = toFirestoreValue_(data.recurrente);              updateFields.push('recurrente'); }
    if (data.notas      !== undefined) { fields.notas      = toFirestoreValue_(data.notas);                   updateFields.push('notas'); }

    var mask = updateFields.map(function(f){ return 'updateMask.fieldPaths=' + f; }).join('&');
    firestoreRequest_('PATCH', '/' + CONFIG.COLLECTION_GASTOS + '/' + id + '?' + mask, { fields: fields });
    return { success: true };

  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function deleteGasto(id, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    if (!verificarPropietario_(CONFIG.COLLECTION_GASTOS, id, user.email)) return { success: false, error: 'No autorizado para eliminar este gasto' };
    firestoreRequest_('PATCH', '/' + CONFIG.COLLECTION_GASTOS + '/' + id + '?updateMask.fieldPaths=activo', { fields: { activo: toFirestoreValue_(false) } });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function marcarGastoPagado(id, pagado, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var gastoDoc = firestoreRequest_('GET', '/' + CONFIG.COLLECTION_GASTOS + '/' + id);
    var gasto    = parseFirestoreDoc_(gastoDoc);
    if (!gasto) return { success: false, error: 'Gasto no encontrado' };
    if (gasto.usuario_id !== user.email) return { success: false, error: 'No autorizado para modificar este gasto' };

    // Marcar como pagado/no pagado en Gastos
    firestoreRequest_('PATCH', '/' + CONFIG.COLLECTION_GASTOS + '/' + id + '?updateMask.fieldPaths=pagado&updateMask.fieldPaths=fecha_pago', {
      fields: { pagado: toFirestoreValue_(pagado), fecha_pago: toFirestoreValue_(pagado ? new Date().toISOString().split('T')[0] : '') }
    });

    if (pagado) {
      // Descontar saldo de cuenta
      if (gasto.cuenta_id) {
        var cuentaDoc = firestoreRequest_('GET', '/' + CONFIG.COLLECTION_CUENTAS + '/' + gasto.cuenta_id);
        var cuenta    = parseFirestoreDoc_(cuentaDoc);
        if (cuenta) {
          updateCuenta(gasto.cuenta_id, { saldo: (parseFloat(cuenta.saldo)||0) - (parseFloat(gasto.monto)||0) }, modoDemo);
          firestoreRequest_('POST', '/' + CONFIG.COLLECTION_TRANSFERENCIAS, {
            fields: objectToFirestore_({
              fecha: new Date().toISOString().split('T')[0], tipo: 'gasto',
              desde_cuenta: gasto.cuenta || '', desde_cuenta_id: gasto.cuenta_id,
              hacia_cuenta: '', monto: parseFloat(gasto.monto)||0,
              categoria: gasto.categoria || 'Otros', descripcion: 'Pago: ' + gasto.nombre,
              referencia_id: id, registrado_por: user.email, fecha_registro: new Date().toISOString(), usuario_id: user.email
            })
          });
        }
      }

      // Copiar automaticamente a Gastos del Periodo
      firestoreRequest_('POST', '/' + CONFIG.COLLECTION_GASTOS_PERIODO, {
        fields: objectToFirestore_({
          nombre:         gasto.nombre    || '',
          monto:          parseFloat(gasto.monto) || 0,
          categoria:      gasto.categoria || 'Otros',
          cuenta:         gasto.cuenta    || '',
          cuenta_id:      gasto.cuenta_id || '',
          notas:          gasto.notas     || '',
          activo:         true,
          fecha:          new Date().toISOString().split('T')[0],
          fecha_creacion: new Date().toISOString(),
          creado_por:     user.email,
          usuario_id:     user.email,
          gasto_id:       id  // referencia al gasto original
        })
      });

    } else {
      // Si se desmarca — buscar y borrar la copia del periodo
      var periodosDocs = firestoreGetAll_(CONFIG.COLLECTION_GASTOS_PERIODO);
      periodosDocs.forEach(function(doc) {
        var gp = parseFirestoreDoc_(doc);
        if (gp && gp.gasto_id === id && gp.activo !== false) {
          firestoreRequest_('PATCH',
            '/' + CONFIG.COLLECTION_GASTOS_PERIODO + '/' + gp.id + '?updateMask.fieldPaths=activo',
            { fields: { activo: toFirestoreValue_(false) } }
          );
        }
      });
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function resetearFacturasMes(modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var docs  = firestoreGetAll_(CONFIG.COLLECTION_GASTOS);
    var count = 0;
    docs.forEach(function(doc) {
      var gasto = parseFirestoreDoc_(doc);
      if (gasto && gasto.activo !== false && gasto.usuario_id === user.email && gasto.recurrente && gasto.pagado) {
        firestoreRequest_('PATCH', '/' + CONFIG.COLLECTION_GASTOS + '/' + gasto.id + '?updateMask.fieldPaths=pagado&updateMask.fieldPaths=fecha_pago', {
          fields: { pagado: toFirestoreValue_(false), fecha_pago: toFirestoreValue_('') }
        });
        count++;
      }
    });
    return { success: true, count: count };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============================================================
//  TRANSFERENCIAS ENTRE CUENTAS (Firebase)

// ============================================================
function getTransferencias(limit, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var docs = firestoreGetAll_(CONFIG.COLLECTION_TRANSFERENCIAS);
    var transferencias = docs.map(function(doc){ return parseFirestoreDoc_(doc); })
      .filter(function(t){ return t && t.usuario_id === user.email; })
      .sort(function(a,b){ return new Date(b.fecha_registro||b.fecha) - new Date(a.fecha_registro||a.fecha); });

    if (limit) transferencias = transferencias.slice(0, limit);
    return { success: true, transferencias: transferencias };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function registrarTransferencia(data, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var monto = parseFloat(data.monto) || 0;
    if (monto <= 0) return { success: false, error: 'El monto debe ser mayor a 0' };
    if (!data.desde_cuenta_id || !data.hacia_cuenta_id) return { success: false, error: 'Seleccione las cuentas' };
    if (data.desde_cuenta_id === data.hacia_cuenta_id) return { success: false, error: 'Las cuentas deben ser diferentes' };
    if (!verificarPropietario_(CONFIG.COLLECTION_CUENTAS, data.desde_cuenta_id, user.email) ||
        !verificarPropietario_(CONFIG.COLLECTION_CUENTAS, data.hacia_cuenta_id, user.email)) {
      return { success: false, error: 'No autorizado para transferir entre estas cuentas' };
    }

    var desdeDoc = firestoreRequest_('GET', '/' + CONFIG.COLLECTION_CUENTAS + '/' + data.desde_cuenta_id);
    var desde    = parseFirestoreDoc_(desdeDoc);
    if (desde) updateCuenta(data.desde_cuenta_id, { saldo: (parseFloat(desde.saldo)||0) - monto }, modoDemo);

    var haciaDoc = firestoreRequest_('GET', '/' + CONFIG.COLLECTION_CUENTAS + '/' + data.hacia_cuenta_id);
    var hacia    = parseFirestoreDoc_(haciaDoc);
    if (hacia) updateCuenta(data.hacia_cuenta_id, { saldo: (parseFloat(hacia.saldo)||0) + monto }, modoDemo);

    var response = firestoreRequest_('POST', '/' + CONFIG.COLLECTION_TRANSFERENCIAS, {
      fields: objectToFirestore_({
        fecha: data.fecha || new Date().toISOString().split('T')[0],
        tipo: 'transferencia',
        desde_cuenta: data.desde_cuenta || '', desde_cuenta_id: data.desde_cuenta_id,
        hacia_cuenta: data.hacia_cuenta || '', hacia_cuenta_id: data.hacia_cuenta_id,
        monto: monto, categoria: 'Transferencia',
        descripcion: data.descripcion || 'Transferencia entre cuentas',
        registrado_por: user.email, fecha_registro: new Date().toISOString(), usuario_id: user.email
      })
    });
    return { success: true, id: response.name ? response.name.split('/').pop() : null };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============================================================
//  RESUMEN FINANCIERO
// ============================================================

function getResumen(modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var cuentasResult  = getCuentas(modoDemo);
    var ingresosResult = getIngresos(modoDemo);
    var gastosResult   = getGastos(modoDemo);

    var totalCuentas   = cuentasResult.success  ? cuentasResult.total          : 0;
    var totalIngresos  = ingresosResult.success  ? ingresosResult.totalMensual  : 0;
    var totalFacturas  = gastosResult.success    ? gastosResult.totalFacturas   : 0;
    var totalPagado    = gastosResult.success    ? gastosResult.totalPagado     : 0;
    var totalPendiente = gastosResult.success    ? gastosResult.totalPendiente  : 0;
    var balance        = totalIngresos - totalFacturas;
    var porcentajeUso  = totalIngresos > 0 ? (totalFacturas / totalIngresos * 100) : 0;

    var diaHoy = new Date().getDate();
    var proximasVencer = [];

    if (gastosResult.success) {
      gastosResult.gastos.forEach(function(g) {
        if (!g.pagado) {
          var diaVence  = parseInt(g.dia_vence) || 1;
          var diasFaltan = diaVence - diaHoy;
          if (diasFaltan < 0) diasFaltan += 30;
          proximasVencer.push({ id: g.id, nombre: g.nombre, monto: g.monto, dia_vence: diaVence, dias_faltan: diasFaltan, categoria: g.categoria, cuenta: g.cuenta });
        }
      });
      proximasVencer.sort(function(a,b){ return a.dias_faltan - b.dias_faltan; });
    }

    return {
      success: true,
      resumen: {
        totalCuentas: totalCuentas, totalIngresos: totalIngresos,
        totalFacturas: totalFacturas, totalPagado: totalPagado,
        totalPendiente: totalPendiente, balance: balance,
        porcentajeUso: porcentajeUso,
        proximasVencer: proximasVencer.slice(0, 10),
        cuentas: cuentasResult.success ? cuentasResult.cuentas : [],
        fechaActualizacion: new Date().toISOString()
      }
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============================================================
//  CATEGORIAS (Firebase)
// ============================================================
function getCategorias() {
  try {
    var docs       = firestoreGetAll_(CONFIG.COLLECTION_CATEGORIAS);

    var categorias = docs.map(function(doc){ return parseFirestoreDoc_(doc); })
                         .filter(function(c){ return c && c.activo !== false; });

    if (categorias.length === 0) return { success: true, categorias: CONFIG.CATEGORIAS_DEFECTO };
    return { success: true, categorias: categorias.map(function(c){ return c.nombre; }) };
  } catch (e) {
    return { success: true, categorias: CONFIG.CATEGORIAS_DEFECTO };
  }
}

// ============================================================
//  PRESUPUESTOS POR CATEGORIA (Firebase)
// ============================================================
function getPresupuestos(modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var docs         = firestoreGetAll_(CONFIG.COLLECTION_PRESUPUESTOS);
    var presupuestos = docs.map(function(doc){ return parseFirestoreDoc_(doc); }).filter(Boolean)
      .filter(function(p){ return p.usuario_id === user.email; });
    return { success: true, presupuestos: presupuestos };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function guardarPresupuestos(lista, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    if (!lista || !lista.length) return { success: true };

    var existentes = firestoreGetAll_(CONFIG.COLLECTION_PRESUPUESTOS)
      .map(function(doc){ return parseFirestoreDoc_(doc); }).filter(Boolean)
      .filter(function(e){ return e.usuario_id === user.email; });

    lista.forEach(function(item) {
      var monto = parseFloat(item.monto) || 0;
      var tipo  = item.tipo || 'main'; // 'main' o 'negocio'

      // Buscar existente por categoria Y tipo
      var actual = existentes.filter(function(e){
        return e && e.categoria === item.categoria && (e.tipo||'main') === tipo;
      })[0];

      if (actual) {
        firestoreRequest_('PATCH',
          '/' + CONFIG.COLLECTION_PRESUPUESTOS + '/' + actual.id + '?updateMask.fieldPaths=monto&updateMask.fieldPaths=tipo',
          { fields: { monto: toFirestoreValue_(monto), tipo: toFirestoreValue_(tipo) } }
        );
      } else {
        firestoreRequest_('POST', '/' + CONFIG.COLLECTION_PRESUPUESTOS, {
          fields: objectToFirestore_({
            categoria: item.categoria, monto: monto, tipo: tipo,
            creado_por: user.email, fecha_creacion: new Date().toISOString(), usuario_id: user.email
          })
        });
      }
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============================================================
//  INICIALIZACION
// ============================================================
function initializeApp() {
  try {
    var email = Session.getActiveUser().getEmail();
    if (!email) return { success: false, error: 'No autorizado' };
    getUsersSheet_();
    return { success: true, message: 'Aplicacion inicializada' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============================================================
//  CUENTA DEMO - datos de ejemplo compartidos
// ============================================================
// Todas las colecciones de la cuenta demo, en el orden en que se limpian.
var COLECCIONES_DEMO_ = [
  'COLLECTION_CUENTAS', 'COLLECTION_INGRESOS', 'COLLECTION_GASTOS',
  'COLLECTION_GASTOS_PERIODO', 'COLLECTION_HISTORIAL_PERIODO',
  'COLLECTION_PRESUPUESTOS', 'COLLECTION_TRANSFERENCIAS'
];

function limpiarDemo_() {
  COLECCIONES_DEMO_.forEach(function(key) {
    var col = CONFIG[key];
    firestoreGetAll_(col).forEach(function(doc) {
      var obj = parseFirestoreDoc_(doc);
      if (obj && obj.usuario_id === CONFIG.DEMO_USER_ID) {
        firestoreRequest_('DELETE', '/' + col + '/' + obj.id);
      }
    });
  });
}

function seedDemoData_() {
  var ahora = new Date().toISOString();
  var demo  = CONFIG.DEMO_USER_ID;

  function crear(col, fields) {
    fields.usuario_id  = demo;
    fields.creado_por  = demo;
    var resp = firestoreRequest_('POST', '/' + col, { fields: objectToFirestore_(fields) });
    return resp.name ? resp.name.split('/').pop() : null;
  }

  var cuentaId = crear(CONFIG.COLLECTION_CUENTAS, {
    nombre: 'Cuenta Principal', saldo: 1250.50, icono: '🏦', color: '#4f46e5',
    tipo: 'corriente', notas: '', activo: true, fecha_creacion: ahora
  });
  crear(CONFIG.COLLECTION_CUENTAS, {
    nombre: 'Ahorros', saldo: 3400, icono: '🐷', color: '#10b981',
    tipo: 'ahorro', notas: '', activo: true, fecha_creacion: ahora
  });

  crear(CONFIG.COLLECTION_INGRESOS, {
    nombre: 'Salario', monto: 900, frecuencia: 'Bisemanal', dia_cobro: 15,
    cuenta_destino: 'Cuenta Principal', cuenta_destino_id: cuentaId,
    activo_recurrente: true, notas: '', activo: true, fecha_creacion: ahora
  });

  var gastosDemo = [
    { nombre: 'Renta',         monto: 450, dia_vence: 1,  categoria: 'Vivienda' },
    { nombre: 'Luz',           monto: 60,  dia_vence: 10, categoria: 'Servicios' },
    { nombre: 'Internet',      monto: 40,  dia_vence: 12, categoria: 'Internet' },
    { nombre: 'Supermercado',  monto: 180, dia_vence: 20, categoria: 'Alimentacion' },
    { nombre: 'Telefono',      monto: 35,  dia_vence: 18, categoria: 'Telefono' }
  ];
  gastosDemo.forEach(function(g) {
    crear(CONFIG.COLLECTION_GASTOS, {
      nombre: g.nombre, monto: g.monto, dia_vence: g.dia_vence, categoria: g.categoria,
      cuenta: 'Cuenta Principal', cuenta_id: cuentaId, pagado: false, fecha_pago: '',
      recurrente: true, notas: '', activo: true, fecha_creacion: ahora
    });
  });

  var presupuestosDemo = { Vivienda: 500, Servicios: 80, Internet: 50, Alimentacion: 220, Telefono: 50 };
  Object.keys(presupuestosDemo).forEach(function(cat) {
    crear(CONFIG.COLLECTION_PRESUPUESTOS, { categoria: cat, monto: presupuestosDemo[cat], tipo: 'main', fecha_creacion: ahora });
  });
}

// Se llama al presionar "Ver Demo" en la pantalla de inicio. Si la cuenta
// demo compartida esta vacia (nadie la ha usado o alguien la vacio), la
// siembra con datos de ejemplo antes de mostrarla.
function entrarModoDemo() {
  try {
    var cuentas = firestoreGetAll_(CONFIG.COLLECTION_CUENTAS)
      .map(function(doc){ return parseFirestoreDoc_(doc); })
      .filter(function(c){ return c && c.usuario_id === CONFIG.DEMO_USER_ID; });
    if (!cuentas.length) seedDemoData_();
    return getProfile(true);
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// Boton "Reiniciar Demo": borra lo que haya y siembra datos de ejemplo
// frescos. Cualquier visitante en modo demo puede usarlo si la demo
// quedo desordenada por otros visitantes.
function resetearDemo() {
  try {
    limpiarDemo_();
    seedDemoData_();
    return { success: true, message: 'Demo reiniciada con datos de ejemplo' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============================================================
//  FIRESTORE HELPERS (OAuth2 Service Account)
// ============================================================
function getFirestoreService_() {
  return OAuth2.createService('Firestore')
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setPrivateKey(getScriptProperty_('FIREBASE_PRIVATE_KEY'))
    .setIssuer(getScriptProperty_('FIREBASE_CLIENT_EMAIL'))
    .setPropertyStore(PropertiesService.getScriptProperties())
    .setScope('https://www.googleapis.com/auth/datastore');
}

function firestoreRequest_(method, path, payload) {
  var service = getFirestoreService_();
  if (!service.hasAccess()) throw new Error('No se pudo autenticar con Firebase: ' + service.getLastError());

  var url     = 'https://firestore.googleapis.com/v1/projects/' + getScriptProperty_('FIREBASE_PROJECT_ID') + '/databases/(default)/documents' + path;
  var options = {
    method: method,
    headers: { 'Authorization': 'Bearer ' + service.getAccessToken(), 'Content-Type': 'application/json' },
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);

  var response = UrlFetchApp.fetch(url, options);
  var result   = JSON.parse(response.getContentText());
  if (result.error) throw new Error(result.error.message || 'Error de Firestore');
  return result;
}

function firestoreGetAll_(collection) {
  try {
    var result = firestoreRequest_('GET', '/' + collection + '?pageSize=500');
    return result.documents || [];
  } catch (e) { return []; }
}

function parseFirestoreDoc_(doc) {
  if (!doc || !doc.fields) return null;
  var obj = {};
  obj.id          = doc.name ? doc.name.split('/').pop() : null;
  obj.firestoreId = obj.id;
  for (var key in doc.fields) { obj[key] = fromFirestoreValue_(doc.fields[key]); }
  return obj;
}

function objectToFirestore_(obj) {
  var fields = {};
  for (var key in obj) { if (obj.hasOwnProperty(key)) fields[key] = toFirestoreValue_(obj[key]); }
  return fields;
}

function toFirestoreValue_(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number')  return Number.isInteger(value) ? { integerValue: value.toString() } : { doubleValue: value };
  if (typeof value === 'string')  return { stringValue: value };
  if (Array.isArray(value))       return { arrayValue: { values: value.map(toFirestoreValue_) } };
  if (typeof value === 'object') {
    var mapFields = {};
    for (var k in value) { if (value.hasOwnProperty(k)) mapFields[k] = toFirestoreValue_(value[k]); }
    return { mapValue: { fields: mapFields } };
  }
  return { stringValue: String(value) };
}

function fromFirestoreValue_(fsValue) {
  if (!fsValue) return null;
  if ('stringValue'    in fsValue) return fsValue.stringValue;
  if ('integerValue'   in fsValue) return parseInt(fsValue.integerValue);
  if ('doubleValue'    in fsValue) return fsValue.doubleValue;
  if ('booleanValue'   in fsValue) return fsValue.booleanValue;
  if ('nullValue'      in fsValue) return null;
  if ('timestampValue' in fsValue) return fsValue.timestampValue;
  if ('arrayValue'     in fsValue) return (fsValue.arrayValue.values || []).map(fromFirestoreValue_);
  if ('mapValue'       in fsValue) {
    var obj = {};
    var fields = fsValue.mapValue.fields || {};
    for (var k in fields) { obj[k] = fromFirestoreValue_(fields[k]); }
    return obj;
  }
  return fsValue;
}

// ============================================================
//  GASTOS DEL PERIODO
// ============================================================

function getGastosPeriodo(modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    var docs   = firestoreGetAll_(CONFIG.COLLECTION_GASTOS_PERIODO);
    var gastos = docs.map(function(doc){ return parseFirestoreDoc_(doc); })
                     .filter(function(g){ return g && g.activo !== false && g.usuario_id === user.email; });
    var total  = gastos.reduce(function(s,g){ return s + (parseFloat(g.monto)||0); }, 0);
    return { success: true, gastos: gastos, total: total };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function addGastoPeriodo(data, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    var gasto = {
      nombre: data.nombre||'', monto: parseFloat(data.monto)||0,
      categoria: data.categoria||'Otros', cuenta: data.cuenta||'',
      cuenta_id: data.cuenta_id||'', notas: data.notas||'',
      activo: true, fecha: new Date().toISOString().split('T')[0],
      fecha_creacion: new Date().toISOString(), creado_por: user.email,
      usuario_id: user.email
    };
    var response = firestoreRequest_('POST', '/' + CONFIG.COLLECTION_GASTOS_PERIODO, { fields: objectToFirestore_(gasto) });
    return { success: true, id: response.name ? response.name.split('/').pop() : null };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function updateGastoPeriodo(id, data, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    if (!verificarPropietario_(CONFIG.COLLECTION_GASTOS_PERIODO, id, user.email)) return { success: false, error: 'No autorizado para modificar este gasto' };
    var fields = {}, updateFields = [];

    if (data.nombre    !== undefined) { fields.nombre    = toFirestoreValue_(data.nombre);                updateFields.push('nombre'); }
    if (data.monto     !== undefined) { fields.monto     = toFirestoreValue_(parseFloat(data.monto)||0); updateFields.push('monto'); }
    if (data.categoria !== undefined) { fields.categoria = toFirestoreValue_(data.categoria);             updateFields.push('categoria'); }
    if (data.cuenta    !== undefined) { fields.cuenta    = toFirestoreValue_(data.cuenta);                updateFields.push('cuenta'); }
    if (data.cuenta_id !== undefined) { fields.cuenta_id = toFirestoreValue_(data.cuenta_id);             updateFields.push('cuenta_id'); }
    if (data.notas     !== undefined) { fields.notas     = toFirestoreValue_(data.notas);                 updateFields.push('notas'); }
    var mask = updateFields.map(function(f){ return 'updateMask.fieldPaths=' + f; }).join('&');
    firestoreRequest_('PATCH', '/' + CONFIG.COLLECTION_GASTOS_PERIODO + '/' + id + '?' + mask, { fields: fields });
    return { success: true };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function deleteGastoPeriodo(id, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    if (!verificarPropietario_(CONFIG.COLLECTION_GASTOS_PERIODO, id, user.email)) return { success: false, error: 'No autorizado para eliminar este gasto' };
    firestoreRequest_('PATCH',
      '/' + CONFIG.COLLECTION_GASTOS_PERIODO + '/' + id + '?updateMask.fieldPaths=activo',
      { fields: { activo: toFirestoreValue_(false) } }
    );
    return { success: true };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function getHistorialPeriodos(modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };
    var docs = firestoreGetAll_(CONFIG.COLLECTION_HISTORIAL_PERIODO);
    var historial = docs.map(function(doc){ return parseFirestoreDoc_(doc); }).filter(Boolean)
      .filter(function(h){ return h.usuario_id === user.email; });
    historial.sort(function(a,b){ return new Date(b.fecha_inicio||0) - new Date(a.fecha_inicio||0); });
    return { success: true, historial: historial };
  } catch(e) { return { success: false, error: e.toString() }; }
}

function reiniciarPeriodo(ingresoCobro, modoDemo) {
  try {
    var user = resolveContext_(modoDemo);
    if (!user.authenticated) return { success: false, error: user.error };

    var ingreso = parseFloat(ingresoCobro) || 0;
    var docsAll = firestoreGetAll_(CONFIG.COLLECTION_GASTOS_PERIODO);
    var docs    = docsAll.filter(function(doc){ var p = parseFirestoreDoc_(doc); return p && p.usuario_id === user.email; });
    var gastos  = docs.map(function(doc){ return parseFirestoreDoc_(doc); }).filter(Boolean);

    // Contar cobros existentes para numerar (solo de este usuario)
    var cobrosExistentes = firestoreGetAll_(CONFIG.COLLECTION_HISTORIAL_PERIODO)
      .map(function(doc){ return parseFirestoreDoc_(doc); })
      .filter(function(h){ return h && h.usuario_id === user.email; });
    var numeroCobro = cobrosExistentes.length + 1;

    if (gastos.length > 0) {
      var total = gastos.reduce(function(s,g){ return s + (parseFloat(g.monto)||0); }, 0);
      var porCategoria = {};
      gastos.forEach(function(g) {
        var c = g.categoria||'Otros';
        porCategoria[c] = (porCategoria[c]||0) + (parseFloat(g.monto)||0);
      });
      firestoreRequest_('POST', '/' + CONFIG.COLLECTION_HISTORIAL_PERIODO, {
        fields: objectToFirestore_({
          fecha_inicio:    gastos[0].fecha || new Date().toISOString().split('T')[0],
          fecha_fin:       new Date().toISOString().split('T')[0],
          total:           total,
          cantidad_gastos: gastos.length,
          por_categoria:   porCategoria,
          ingreso_cobro:   ingreso,
          ahorro:          ingreso - total,
          numero_cobro:    numeroCobro,
          cerrado_por:     user.email,
          fecha_cierre:    new Date().toISOString(),
          usuario_id:      user.email
        })
      });
    }

    var count = 0;
    docs.forEach(function(doc) {
      var g = parseFirestoreDoc_(doc);
      if (g && g.id) {
        firestoreRequest_('PATCH',
          '/' + CONFIG.COLLECTION_GASTOS_PERIODO + '/' + g.id + '?updateMask.fieldPaths=activo',

          { fields: { activo: toFirestoreValue_(false) } }
        );
        count++;
      }
    });

    var presDocs = firestoreGetAll_(CONFIG.COLLECTION_PRESUPUESTOS);
    presDocs.forEach(function(doc) {
      var pre = parseFirestoreDoc_(doc);
      if (pre && pre.id && pre.usuario_id === user.email) {
        firestoreRequest_('PATCH',

          '/' + CONFIG.COLLECTION_PRESUPUESTOS + '/' + pre.id + '?updateMask.fieldPaths=monto',
          { fields: { monto: toFirestoreValue_(0) } }
        );
      }
    });

    return { success: true, gastosArchivados: count };
  } catch(e) { return { success: false, error: e.toString() }; }
}
