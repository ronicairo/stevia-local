window.addEventListener('DOMContentLoaded', function () {
    const period = document.getElementById('period')
    $('#period').datepicker({
        changeMonth: true,
        changeYear: true,
        showButtonPanel: true,
        closeText: 'Valider',
        currentText: 'Aujourd\'hui',
        dateFormat: 'mm/yy',
        onClose: function () {
            const month = $("#ui-datepicker-div .ui-datepicker-month :selected").val();
            const year = $("#ui-datepicker-div .ui-datepicker-year :selected").val();
            if (month !== null && year !== null) {
                const formattedDate = $.datepicker.formatDate('mm/yy', new Date(year, month, 1));
                $(this).val(formattedDate);
                $('#list-stats-calcul-part-mutuelle').DataTable().draw();
            }
        },
        beforeShow: function (input, inst) {
            inst.dpDiv.addClass('month_year_datepicker');
            const datestr = $(this).val();
            if (datestr && /^\d{2}\/\d{4}$/.test(datestr)) {
                try {
                    const date = $.datepicker.parseDate('mm/yy', datestr);
                    $(this).datepicker('option', 'defaultDate', date);
                    $(this).datepicker('setDate', date);
                } catch (e) {
                }
            }
        }
    });

    const table = $('#list-stats-calcul-part-mutuelle').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('etat_mensuel_calcul_mutuelle_get_data'),
            data: d => {
                d.period = period.value
                d.filters = getFilters('list-stats-calcul-part-mutuelle')
            }
        },
        order: [[1, 'asc']],
        columns: [
            {
                "data": "dateDetect",
                "name": "dateDetect"
            },
            {
                "data": "numeroCreance",
                "name": "numeroCreance",
            },
            {
                "data": "natureCompte",
                "name": "natureCompte"
            },
            {
                "data": "numCompte",
                "name": "numCompte"
            },
            {
                "data": "numeroDebiteur",
                "name": "numeroDebiteur",
                "className": "clickable-debiteur"
            },
            {
                "data": "catDebiteur",
                "name": "catDebiteur"
            },
            {
                "data": "matriculeAssure",
                "name": "matriculeAssure"
            },
            {
                "data": "activite",
                "name": "activite"
            },
            {
                "data": "partMutuel",
                "name": "partMutuel",
                className: 'dt-body-right'
            },
            {
                "data": "montantMutuel",
                "name": "montantMutuel",
                "orderable": false,
                className: 'dt-body-right'
            },
            {
                "data": "soldeMutuel",
                "name": "soldeMutuel",
                "orderable": false,
                className: 'dt-body-right'
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('etat_mensuel_calcul_part_mutuelle_export'),
                        data: JSON.stringify({
                                filters: getFilters('list-stats-calcul-part-mutuelle'),
                                period: period.value
                            }
                        ),
                        method: "POST",
                        success: (response) => {
                            const link = document.createElement('a');
                            const BOM = new Uint8Array([0xEF,0xBB,0xBF]);
                            link.href = window.URL.createObjectURL(
                                new Blob(
                                    [BOM, response],
                                    {type: 'text/csv'}
                                )
                            );
                            link.download = 'stats_calcul_part_mutuelle.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function () {
                            // En cas d'erreur, on arrête le spinner et on affiche une alerte.
                            $('#list-stats-calcul-part-mutuelle').DataTable().processing(false);
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.');
                        },
                    });
                }
            }
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing')
            $('#custom-container').append(processingDiv)
        },
    })

    initializeClickableDebiteur(table)

    const initializeSoldesWithDynamicPeriod = (table, footers, route, periodInput, colIndex = null, devise = '') => {
        Object.values(footers).forEach($el => $el.text('Calcul...'));

        table.on('draw.dt order.dt', () => {
            // Crée les options dynamiquement ici, juste avant l'appel à getSoldes
            const dynamicOptions = {
                period: periodInput.value // Récupère la valeur la plus récente de l'input 'period'
            };

            getSoldes(
                soldes => Object.keys(footers).forEach(key => footers[key].text(soldes[key])),
                table,
                route,
                dynamicOptions, // Passe les options dynamiques à getSoldes
                colIndex,
                devise
            );
        });
    };

    initializeFilters(table)
    initializeButtons(table)

    const footers = {
        totalPartMutuel: $('#list-stats-calcul-part-mutuelle_wrapper .dt-scroll-foot tfoot tr th:eq(8)')
    }
    const route = Routing.generate('etat_mensuel_calcul_part_mutuelle_soldes')

    // Appel de la fonction spécifique pour les soldes dynamiques
    initializeSoldesWithDynamicPeriod(table, footers, route, period);

    period.addEventListener('change', () => {
        if (period.value) $('#list-stats-calcul-part-mutuelle').DataTable().draw()
    })

    document.getElementById('period-icon').addEventListener('click', function () {
        document.getElementById('period').focus();
    });
})