window.addEventListener('DOMContentLoaded', function () {
    const table = $('#list-suivi-suspensions-dataTable').DataTable({
        ajax: {url: Routing.generate('pilotage_statistique_suivi_suspensions_get_data')},
        dom: 'Bt<"bottom d-flex justify-content-between align-items-center"i p>',
        buttons: [
            {
                extend: 'csv',
                title: 'suivi_suspensions',
                text: 'Exporter en CSV',
                charset: 'utf-8',
                fieldSeparator: ';',
                bom: true
            }
        ],
        columns: [
            {
                data: "motif",
                name: "ms.libelle",
                "render": function (data) {
                    const routeName = data === 'ANV' ? 'creance_suspendus_motif_anv' : 'creance_suspendus_pole_motif'
                    const url = Routing.generate(routeName, {suspension: data});

                    return `<div class="text-center"><a href="${url}" data-suspension-libelle="${data}" class="btn-view-suspensions">${data}</a></div>`
                }
            },
            {
                data: "nombre",
                name: "nombre"
            },
            {
                data: "dateSuspension",
                name: "dateSuspension"
            },
        ],
        footerCallback: function () {
            let api = this.api();
            // Remove the formatting to get integer data for summation
            let intVal = function (i) {
                return typeof i === 'string'
                    ? i.replace(/[\$,]/g, '') * 1
                    : typeof i === 'number'
                        ? i
                        : 0;
            };

            // Update footer
            api.column(1).footer().innerHTML =
                api.column(1, {page: 'current'})
                    .data()
                    .reduce((a, b) => intVal(a) + intVal(b), 0);
        },
        initComplete: function (settings) {
            const btnViewSuspensions = settings.nTable.querySelectorAll('.btn-view-suspensions');

            btnViewSuspensions.forEach(btn => {
                btn.addEventListener('click', function (e) {
                    e.preventDefault();

                    const libelle = btn.getAttribute('data-suspension-libelle')

                    filters['creance_suspendus_pole_motif-dataTable'] = {}

                    filters['creance_suspendus_pole_motif-dataTable']['libelleMotif'] = {
                        'value': libelle,
                        'operator': '=',
                        'type': 'list'

                    }

                    localStorage.setItem('filters', JSON.stringify(filters))

                    window.location.href = btn.href
                })
            })
        }
    });

    initializeFilters(table);
    initializeButtons(table);
});
