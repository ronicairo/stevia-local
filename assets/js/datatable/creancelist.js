window.addEventListener('DOMContentLoaded', function () {
    const JsVars = $("#js-vars").data('vars');
    const showWfCol = document.getElementById('show-wf-col')?.value === '1';
    const table = $('#list-creance-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>',
        ajax: {
            url: Routing.generate('creance_liste'),
            method: 'POST',
            data: function (d) {
                d.filters = {'filters': getFilters('list-creance-dataTable')}
                return d;
            }
        },
        order: [[0, 'desc']],
        columns: [
            {
                "data": "numeroCreance",
                "name": "numeroCreance",
                "render": function (data, type, row) {
                    // Redirige vers le détail de la créance en fonction du rôle de l'utilisateur.
                    const url = (JsVars['privilege'] === 'consult' || JsVars['privilege'] === 'notif')
                        ? Routing.generate('creance_parcours_show', { id: row.creanceId })
                        : Routing.generate('creance_edit', { id: row.creanceId })
                    return '<a href="' + url + '">' + data + '</a>';
                }
            },
            {
                "data": "numeroDebiteur",
                "name": "numeroDebiteur",
                "className": "clickable-debiteur"
            },
            {
                "data": "numeroReference",
                "name": "numeroReference",
                "render": function (data) {
                    // N'affiche que les numéros de référence non nuls.
                    return data !== null ? data : '';
                }
            },
            {
                "data": "natureCompte",
                "name": "natureCompte"
            },
            {
                "data": "catDebiteur",
                "name": "catDebiteur"
            },
            {
                "data": "montantInitial",
                "name": "montantInitial",
                className: 'dt-body-right'
            },
            {
                "data": "solde",
                "name": "solde",
                className: 'dt-body-right'
            },
            {
                "data": "numUgeDetect",
                "name": "numUgeDetect"
            },
            {
                "data": null,
                "name": "etat",
                "render": function (data) {
                    return stateIcon(data);
                }
            },
            {
                "data": "workflow",
                "name": "workflow",
                "render": function (data) {
                    if(data === null) return '';
                    const url = Routing.generate('etape_wf', { workflowId: data });
                    return `<a href="${url}">${data}</a>`;
                }
            }
        ],
        initComplete: function () {
            // Déplace le message de traitement dans un autre conteneur
            const processingDiv = $('.dt-processing');
            $('#custom-container').append(processingDiv);

            this.api().column('workflow:name').visible(showWfCol);
        }
    });

    const stateIcon = function (data) {
        let icon_lock = '';
        let icon_state = '';

        if (data['verrou'] !== null) {
            icon_lock = `<i class="bi bi-lock-fill text-danger fs-5 p-2" title="Verrouillée par ${data['verrou']}"></i>`;
        }

        switch (data['etat']) {
            case '0':
                return icon_lock;
            case '1':
                icon_state = "<i class='bi-file-earmark-word text-primary fs-5 p-2' title='Créance notifiée'></i>";
                return icon_lock + icon_state;
            case '2':
            case '3':
                icon_state = `<i class="bi bi-clock text-primary fs-5 p-2" title="Suspendue pour : ${data['libelle']}"></i>`;
                return icon_lock + icon_state;
            default :
                return data;
        }
    }

    initializeClickableDebiteur(table)
    initializeFilters(table)
    initializeButtons(table)
    initializeNumDebFilterFromURL(table)
    rememberDataTable(table)

    const footers = {
        totalMontantInitial: $('#list-creance-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(5)'),
        totalSolde: $('#list-creance-dataTable_wrapper .dt-scroll-foot tfoot tr th:eq(6)')
    }
    const route = Routing.generate('creances_liste_soldes')

    initializeSoldes(table, footers, route)
});