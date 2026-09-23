# KmSplit 🚗⛽
🔗 **[Ver la app en vivo](https://kmsplit.vercel.app/login)**
> Reparto justo del gasto de combustible en autos compartidos, proporcional a los km recorridos por cada persona.

## Descripción

KmSplit es una aplicación web mobile-first que resuelve un problema muy común en familias o grupos que comparten un mismo auto: **repartir el gasto de combustible de forma justa**, según cuánto manejó realmente cada persona, y no de forma equitativa a ciegas.

La app permite registrar los viajes diarios de cada conductor y las cargas de combustible, calculando automáticamente cuánto le corresponde pagar a cada integrante del grupo en base a los kilómetros recorridos entre carga y carga.

## Problema que resuelve

Cuando varias personas comparten un vehículo (por ejemplo, en una familia), es común que el gasto de combustible se divida en partes iguales sin importar quién usó más el auto. Esto genera injusticias y discusiones. Llevar este control a mano en una planilla de cálculo funciona, pero es incómodo, propenso a errores y difícil de mantener actualizado desde el celular.

KmSplit digitaliza y automatiza ese proceso, ofreciendo:

- Registro rápido de viajes desde el celular (mobile-first)
- Cálculo automático y transparente del reparto proporcional
- Historial y visualización clara del gasto de cada integrante
- Detección de kilómetros no asignados (viajes no registrados) para mantener la trazabilidad

## Funcionalidades (MVP)

- [x] Registro y login de usuarios
- [x] Creación de grupos (familia/convivientes) y vehículo asociado
- [x] Carga de viajes diarios (usuario, km inicial, km final)
- [x] Carga de combustible (fecha, km del odómetro, monto total)
- [x] Cálculo automático de liquidación/reparto entre cargas
- [x] Dashboard con historial y gráficos de gasto por persona
- [x] Diseño responsive, mobile-first

## Stack tecnológico

**Backend:** Django + Django REST Framework, PostgreSQL    
**Frontend:** Angular, Html, Scss, Tailwind    
**Diseño:** Figma    
**Infraestructura:** Docker, Docker Compose    
**Deploy:** Backend en Railway, Frontend en Vercel, CI/CD automático
desde GitHub (cada push a `main` deploya solo).  

## 📂 Estructura del proyecto  

```text
KmSplit/
├── backend/                  # API Django REST Framework
│   ├── accounts/             # Autenticación y usuarios
│   ├── core/                 # Lógica principal de la aplicación
│   ├── config/               # Configuración de Django
│   ├── manage.py
│   └── requirements.txt
│
├── frontend/                 # Aplicación Angular
│   ├── src/
│   │   └── app/
│   │       ├── core/         # Guards, interceptores, modelos y servicios
│   │       ├── features/    # Funcionalidades principales
│   │       └── shared/      # Componentes reutilizables
│   ├── angular.json
│   └── package.json
│
├── docker-compose.yml        # Orquestación de los servicios
└── README.md                 # Documentación del proyecto
```
## 📸 Capturas / Demo

> Se agregaron capturas de pantalla de todo el avance del proyecto, como los diagramas de flujo, capturas de los wireframes y el modelo relacional de la base de datos en la primera estapa de proyecto.        
>

### 🔄 Diagrama de Flujo

Se documentó el flujo completo de la aplicación, desde el onboarding del usuario hasta la lógica de liquidación automática, incluyendo el circuito de edición de viajes cargados tarde y su impacto en el recálculo del reparto.

💡 **¿Por qué es importante este flujo?**

El punto más delicado del sistema es la liquidación: si un viaje se carga después de que ya se generó el reparto de una carga de combustible, el sistema lo detecta, lo asocia al período correspondiente y **recalcula automáticamente** cuánto le toca pagar a cada integrante — sin intervención manual.

```mermaid
flowchart TD
    A([Usuario abre la app]) --> B{¿Tiene cuenta?}
    B -- No --> C[Registro]
    B -- Sí --> D[Login]
    C --> D
    D --> E{¿Pertenece a algún grupo?}
    E -- No --> F[Crear grupo y agregar vehículo]
    E -- Sí --> G[Selección de vehículo]
    F --> G
    G --> H[Menú del vehículo]

    H --> I[Registrar viaje]
    H --> J[Registrar carga]
    H --> K[Ver dashboard]
    H --> L[Historial]

    I --> I0[Muestra último viaje cargado]
    I0 --> I1{¿Editar último o cargar nuevo?}
    I1 -- Cargar nuevo --> I2[Ingresa fecha y km final]
    I1 -- Editar último --> I2
    I2 --> I3[Sistema calcula km recorridos]
    I3 --> I4{¿El km cae en un settlement ya existente?}
    I4 -- Sí --> I5[Asigna settlement_id al viaje]
    I4 -- No --> I6[(Guarda viaje sin settlement_id)]
    I5 --> I7[Recalcula ese settlement]
    I7 --> I8[(Actualiza settlement_details)]
    I6 --> H
    I8 --> H

    L --> L1[Lista de viajes y cargas]
    L1 --> L2[Editar un viaje]
    L2 --> I4

    J --> J1[Ingresa fecha, km odómetro y monto]
    J1 --> J2[Sistema busca viajes desde la última carga]
    J2 --> J3[Calcula km_sin_asignar]
    J3 --> J4{¿Hay km sin asignar?}
    J4 -- Sí --> J5[Reparte equitativamente entre integrantes]
    J4 -- No --> J6[Calcula % de uso por integrante]
    J5 --> J6
    J6 --> J7[(Crea settlement + settlement_details)]
    J7 --> K

    K --> K1[Muestra últimos 5 registros]
    K --> K2[Muestra km sin asignar, si hay]
    K --> K3[Muestra gráfico de uso por integrante]
    K --> K4{¿Ver más?}
    K4 -- Semana --> K5[Vista semanal]
    K4 -- Histórico --> K6[Historial completo]
```


> 
> 🎨 **Paleta de colores**       
Gama de azules y grises pensada para transmitir claridad y confianza, con acentos puntuales (ámbar para alertas, verde para confirmaciones) que ayudan al usuario a identificar rápido el estado de sus registros.
> 
Ver paleta completa:     
> <img width="1239" height="331" alt="image" src="https://github.com/user-attachments/assets/4cfcc940-c68d-421c-ae1f-398d73609b13" />        
[Link al Figma](https://www.figma.com/design/laSA5OAyx2tbP8l0ezerSE/KmSplit?node-id=0-1&t=eRqsWqXdQEigd7KL-1)    

📱 **Wireframes (Mobile-First)**    
Antes de escribir código se diseñaron los wireframes de baja fidelidad de las 9 pantallas del MVP, priorizando un flujo mobile-first ya que la carga de datos (viajes y combustible) se hace principalmente desde el celular, al lado del auto.    
    
Ver wireframes: 
> 
> Login, Registro y Recuperar contraseña    
> 
> <img width="873" height="549" alt="image" src="https://github.com/user-attachments/assets/78a56cb6-f0da-4b63-b659-c335a4968b07" />    

> Seleccion de vehículo, Menú del vehículo y Registrar viaje    
> 
> <img width="879" height="545" alt="image" src="https://github.com/user-attachments/assets/d72e5287-f259-4289-8776-a562b8c54896" />      

> Registro de carga, Resumen y Historial semanal    
> 
> <img width="888" height="549" alt="image" src="https://github.com/user-attachments/assets/82c94691-b977-405a-b8fd-ab19e437fdc9" />    

📂 Estructura de la Base de Datos      
Para este proyecto se diseñó el Modelo Relacional utilizando dbdiagram.io, una potente herramienta basada en DBML (Database Markup Language). Este enfoque de "arquitectura como código" permite mantener la documentación visual perfectamente sincronizada con la estructura lógica del sistema.

💡 ¿Por qué se incluye este modelo y para qué sirve?
- Claridad del Dominio: Permite entender de un vistazo cómo interactúan las entidades críticas del sistema (como users, vehicles, groups y trips).
- Integridad de Datos: Documenta de forma explícita las relaciones de la base de datos, definiendo las claves primarias (pk) y foráneas (fk) que aseguran la consistencia de la información.
- Mantenibilidad Extensible: Al estar escrito en código DBML, cualquier cambio futuro en el modelo se puede versionar en Git de la misma manera que el código fuente de la aplicación.
- Agilidad en el Desarrollo: Sirve como una guía visual directa para escribir las migraciones, modelos o consultas en el backend sin lugar a ambigüedades.

[Link al Diagrama del Modelo Relacional](https://dbdiagram.io/d/KmSplit-6a5079094ac62e474c724e47)     

<img width="1239" height="798" alt="image" src="https://github.com/user-attachments/assets/03323a2e-888f-42a1-b673-3a5da96884dc" />






## Roadmap

- [x] Definición del proyecto y modelo de datos
- [x] Wireframes mobile-first
- [x] Modelos y lógica de backend
- [x] CRUD básico (viajes, cargas, grupos)
- [x] Lógica de liquidación/reparto
- [x] Frontend mobile-first
- [x] Deploy
- [ ] Funcionalidades extra (login con google, invitar por link, exportar PDF)

## 👤 Autor

**Mariano Casarino** — Estudiante de la Tecnicatura Superior en Desarrollo de Software (TSDS), ISPC, Córdoba, Argentina.
Full Stack Developer Jr en formación | [LinkedIn](https://www.linkedin.com/in/mariano-casarino) | [Portfolio](https://porfolio-mariano-casarino.vercel.app/)

## 📄 Licencia

Este proyecto es de código abierto y fue creado con fines de portfolio y aprendizaje.
