window.addEventListener('DOMContentLoaded', function () {
    const idListWF = document.getElementById('idListWF').value
    const idEtapeWF = document.getElementById('idEtapeWF').value

    $('#params-wf-dataTable').DataTable({
        ajax: Routing.generate('parametrage_wf', {
            'id': idEtapeWF,
            'idlwf': idListWF,
        }),
        dom: 'ti',
        searching: true,
        columns: [
            {
                "data": "id",
                "name": "id"
            },
            {
                "data": "libtypparam",
                "name": "type"
            },
            {
                "data": "valeur",
                "name": "value",
                "render": function (data) {
                    // Mapping pour les pièces jointes, pour lesquelles le champ valeur ne contient pas de libellé
                    const mapping = {
                        '0': 'aucune pièce jointe',
                        '1': 'pièces jointes facultatives',
                        '2': 'pièces jointes obligatoires'
                    }
                    // Si la valeur correspond à une clé, retourne le libellé, sinon la valeur brute
                    return mapping[data] ?? data
                }
            },
            {
                "data": "libetapWF",
                "name": "etapeWF",
            },

            {
                "name": "update",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('parametrage_wf_update', {
                        'idEtapeWF': idEtapeWF,
                        'idListeWF': idListWF,
                        'id': row.id,
                        'typeaction': row.codeLib,
                        'libelle': row.libetapWF
                    })

                    return `<div class="text-center"><a href="${url}" title="Modifier"><i class='fs-3 bi bi-pencil-square'></i></a></div>`
                }
            },
        ]
    })
})