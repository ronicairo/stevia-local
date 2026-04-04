window.addEventListener('DOMContentLoaded', function () {
    const table = $('#suivi-alert-dataTable').DataTable({
        ajax: Routing.generate('pilotage_statistique_suivi_alertes'),
        dom: 'Bti',
        buttons: [
            {
                extend: 'csv',
                title: 'Suivi Des Echéances',
                text: 'Exporter en CSV',
                charset: 'utf-8',
                fieldSeparator: ';',
                bom: true
            }
        ],
        layout: {
            topStart: 'buttons'
        },
        columns: [
            {
                "data": "libelle",
                "name": "libelle",
                "orderable": false
            },
            {
                "data": "length",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('echeance')
                    return `<div class="text-center">
                                <a 
                                    href="${url}" 
                                    data-echeance-libelle='${row.libelleData}'
                                    data-echeance-search='${row.libelle}'
                                    class='btn-view-echeances' title="Tableau d'echéances de suivi - ${row.libelle}">${row.length}
                                </a>
                            </div>`
                }
            },
            {
                "data": "anteriority",
                "name": "anteriority"
            }
        ],
        initComplete: function (settings) {
            const btnsViewecheances = settings.nTable.querySelectorAll('.btn-view-echeances');

            btnsViewecheances.forEach(btn => {
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    const libelle = btn.getAttribute('data-echeance-libelle')
                    const search = btn.getAttribute('data-echeance-search')

                    filters['suivi-echeance-dataTable'] = {}

                    // Pour faire une recherche de type 'between' ou 'greater',
                    // il faut passer comme valeur de la clé operator.field le champ SQL sur lequel la condition s'applique.
                    if (search.includes('80')) {
                        filters['suivi-echeance-dataTable']['echeance'] = {
                            value: `${libelle}`,
                            operator: { field: 'solde', min: '80', max: '299.99' },
                            type: 'between'
                        }
                    } else if (search.includes('300')) {
                        filters['suivi-echeance-dataTable']['echeance'] = {
                            value: `${libelle}`,
                            operator: { field: 'solde', min: '300', max: '999.99' },
                            type: 'between'
                        }
                    } else if (search.includes(('1 000'))) {
                        filters['suivi-echeance-dataTable']['echeance'] = {
                            value: `${libelle}`,
                            operator: { field: 'solde', operator: '>=', value: '1000' },
                            type: 'greater'
                        };
                    } else {
                        filters['suivi-echeance-dataTable']['echeance'] = {
                            value: `${libelle}`,
                            operator: '=',
                            type: 'list'
                        };
                    }

                    // Ajout de la date du jour en filtre date echéance lors du click
                    filters['suivi-echeance-dataTable']['dateEcheance'] = {
                        value: new Date().toISOString().split('T')[0],
                        operator: '<=',
                        type: 'date'
                    };
                    
                    localStorage.setItem('filters', JSON.stringify(filters))

                    window.location.href = btn.href
                })
            })
        },
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
        }
    })

    initializeButtons(table)
})