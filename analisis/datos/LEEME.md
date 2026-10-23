# Exportaciones de la app

Copia aquí los archivos `arriesga-….json` que exporta la app (pantalla «Datos» → «Exportar datos»).

- Puedes juntar exportaciones de varios móviles y de distintas fechas: la calibración elimina los registros repetidos.
- No hace falta borrar las antiguas: cada calibración usa todo lo que haya aquí.
- Estos archivos llevan los nombres de los jugadores, y por eso `.gitignore` los excluye del repositorio.

Después ejecuta, desde la carpeta raíz del proyecto:

    py analisis/calibrar.py
