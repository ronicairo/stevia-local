window.addEventListener('DOMContentLoaded', function () {
    generateMouvementsDatatable(document.getElementById('num_creance').value ?? 'noId');

    let creanceTabsBtn = document.querySelectorAll('.nav-item-creance');
    creanceTabsBtn.forEach(tabBtn => {
        tabBtn.addEventListener('click', function () {
            generateMouvementsDatatable(this.dataset.numcreance);
        });
    })
});

function generateMouvementsDatatable(numeroCreance)
{
    $('#detailsMvt-dataTable').DataTable({
        ajax: Routing.generate('mouvements_get_data', {numeroCreance: numeroCreance }),
        columns: [
            {
                'data': 'date',
                'name': 'date'
            },
            {
                'data': 'operation',
                'name': 'operation'
            },
            {
                'data': 'montant',
                'name': 'montant'
            },
            {
                'data': 'nature_cpt',
                'name': 'nature_cpt'
            }
        ],
        destroy: true,
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing');
            $('#custom-container').append(processingDiv);
        }
    })
}